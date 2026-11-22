#!/usr/bin/env bash
# Prepares a ThunderID server for Auth Playground:
#   1. allows the playground's origins in the server-wide CORS list,
#   2. creates two organizations (OUs) under a parent,
#   3. creates test users: one in each organization, and one shared into both,
#   4. creates a public PKCE browser application in the parent, shared with both organizations, with
#      the device code grant (and a device grant flow that calls the application's sign-in flow),
#   5. creates a confidential m2m application for client credentials and token exchange.
#
# Usage: BASE=https://localhost:8090 ADMIN_PASSWORD=... ./scripts/thunderid-setup.sh
# Optional: ORIGINS="https://auth-playground.yeshandev.com http://localhost:5173"
#           CLIENT_ID=auth-playground   REDIRECTS="<origin>/callback ..."
#           AUTH_FLOW=<sign-in flow ID for the browser application>   CONSOLE_REDIRECT   PACK_DIR
# Needs curl, jq and openssl. Writes the created IDs to scripts/.thunderid-env (git-ignored).
set -euo pipefail

BASE="${BASE:-https://localhost:8090}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?set ADMIN_PASSWORD to the ThunderID admin password}"
ORIGINS="${ORIGINS:-https://auth-playground.yeshandev.com http://localhost:5173}"
CLIENT_ID="${CLIENT_ID:-auth-playground}"
TEST_PASSWORD="${TEST_PASSWORD:-Playground@123}"
DEFAULT_OU="01900000-0000-7000-8000-000000000001"
# Bootstrap flows: the sign-in flow the browser application uses and the default device grant flow.
AUTH_FLOW="${AUTH_FLOW:-01900000-0000-7000-8000-000000000068}"
DEFAULT_DEVICE_FLOW="01900000-0000-7000-8000-00000000008a"
# The Console's system resource server identifier. It is a fixed name from the server's bootstrap
# data, not derived from BASE; override it if your server's bootstrap uses another.
SYSTEM_RS="${SYSTEM_RS:-https://localhost:8090/mcp}"
CONSOLE_REDIRECT="${CONSOLE_REDIRECT:-$BASE/console}"
ENV_FILE="$(cd "$(dirname "$0")" && pwd)/.thunderid-env"
SUFFIX="${SUFFIX:-$(date +%s | tail -c 5)}"

REDIRECTS="${REDIRECTS:-}"
POST_LOGOUT="${POST_LOGOUT:-}"
if [ -z "$REDIRECTS" ]; then
  for o in $ORIGINS; do REDIRECTS="$REDIRECTS $o/callback"; done
fi
if [ -z "$POST_LOGOUT" ]; then
  for o in $ORIGINS; do POST_LOGOUT="$POST_LOGOUT $o/"; done
fi

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# Signs the admin in to the Console client through authorize → flow API → callback → token.
admin_token() {
  local verifier challenge location exec_id auth_id step assertion cb code
  verifier="$(openssl rand 32 | b64url)"
  challenge="$(printf '%s' "$verifier" | openssl dgst -sha256 -binary | b64url)"
  location="$(curl -sk -o /dev/null -w '%{redirect_url}' -G "$BASE/oauth2/authorize" \
    --data-urlencode client_id=CONSOLE --data-urlencode "redirect_uri=$CONSOLE_REDIRECT" \
    --data-urlencode response_type=code --data-urlencode "scope=openid system" \
    --data-urlencode state=setup --data-urlencode "code_challenge=$challenge" \
    --data-urlencode code_challenge_method=S256 --data-urlencode "resource=$SYSTEM_RS")"
  auth_id="$(sed -n 's/.*[?&]authId=\([^&]*\).*/\1/p' <<<"$location")"
  exec_id="$(sed -n 's/.*[?&]executionId=\([^&]*\).*/\1/p' <<<"$location")"
  [ -n "$exec_id" ] || { echo "authorize failed: $location" >&2; exit 1; }
  step="$(curl -sk "$BASE/flow/execute" -H 'Content-Type: application/json' -d "{\"executionId\":\"$exec_id\"}")"
  local ct; ct="$(jq -r '.challengeToken // empty' <<<"$step")"
  # The password goes through the environment and stdin, never a command-line argument (ps shows those).
  step="$(ADMIN_PASSWORD="$ADMIN_PASSWORD" jq -nc --arg e "$exec_id" --arg c "$ct" --arg u "$ADMIN_USERNAME" \
    '{executionId:$e, action:"action_001", inputs:{username:$u, password:env.ADMIN_PASSWORD}}
    + (if $c == "" then {} else {challengeToken:$c} end)' \
    | curl -sk "$BASE/flow/execute" -H 'Content-Type: application/json' --data-binary @-)"
  assertion="$(jq -r '.assertion // empty' <<<"$step")"
  [ -n "$assertion" ] || { echo "admin sign-in failed: $step" >&2; exit 1; }
  cb="$(curl -sk "$BASE/oauth2/auth/callback" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg a "$auth_id" --arg s "$assertion" '{authId:$a, assertion:$s}')")"
  code="$(jq -r '.redirect_uri // empty' <<<"$cb" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')"
  curl -sk "$BASE/oauth2/token" --data-urlencode grant_type=authorization_code --data-urlencode "code=$code" \
    --data-urlencode "redirect_uri=$CONSOLE_REDIRECT" --data-urlencode client_id=CONSOLE \
    --data-urlencode "code_verifier=$verifier" --data-urlencode "resource=$SYSTEM_RS" | jq -er .access_token
}

TOKEN="$(admin_token)"
AUTH_HEADER="$(umask 077; mktemp)"
trap 'rm -f "$AUTH_HEADER"' EXIT
printf 'Authorization: Bearer %s\n' "$TOKEN" >"$AUTH_HEADER"
export TEST_PASSWORD
# The admin token and request bodies (which hold test passwords) reach curl through a private header
# file and stdin, not its command line.
api() {
  local method="$1" path="$2" body="${3:-}" out status
  out="$(mktemp)"
  status="$(printf '%s' "$body" | curl -sk -o "$out" -w '%{http_code}' -X "$method" "$BASE$path" -H "@$AUTH_HEADER" \
    -H 'Content-Type: application/json' ${body:+--data-binary @-})"
  if [ "$status" -ge 300 ]; then echo "$method $path → $status: $(cat "$out")" >&2; rm -f "$out"; return 1; fi
  cat "$out"; rm -f "$out"
}
create() { api POST "$1" "$2" | jq -er .id; }

echo "1. CORS: allowing $ORIGINS"
# A standalone or data-plane server accepts deployment-wide writes such as the CORS list only through
# import or the declarative file, so the runtime PUT is refused there (403). Fall back to the file.
CORS_BODY="$(jq -nc --arg o "$ORIGINS" '{allowedOrigins: ($o | split(" ") | map(select(. != "")))}')"
if api PUT /server-config/cors "$CORS_BODY" >/dev/null 2>&1; then
  echo "   applied at runtime"
elif [ -n "${PACK_DIR:-}" ]; then
  f="$PACK_DIR/config/resources/server_configs/cors.yaml"
  { echo "resource_type: server_config"; echo "name: cors"; echo "value:"; echo "  allowedOrigins:"
    for o in $ORIGINS; do echo "    - \"$o\""; done; } >"$f"
  echo "   wrote $f; restart the server for it to take effect"
else
  echo "   the server refused a runtime update; create config/resources/server_configs/cors.yaml in the"
  echo "   server folder (or rerun with PACK_DIR=<server folder>) and restart:"
  echo "     resource_type: server_config"; echo "     name: cors"; echo "     value:"; echo "       allowedOrigins:"
  for o in $ORIGINS; do echo "         - \"$o\""; done
fi

echo "2. Organizations"
PARENT_OU="$(create /organization-units "$(jq -nc --arg p "$DEFAULT_OU" --arg s "$SUFFIX" '{handle:("customers-"+$s), name:("Customers "+$s), parent:$p}')")"
ORG_A="$(create /organization-units "$(jq -nc --arg p "$PARENT_OU" --arg s "$SUFFIX" '{handle:("northstar-"+$s), name:("Northstar Labs "+$s), parent:$p}')")"
ORG_B="$(create /organization-units "$(jq -nc --arg p "$PARENT_OU" --arg s "$SUFFIX" '{handle:("initech-"+$s), name:("Initech "+$s), parent:$p}')")"
echo "   parent $PARENT_OU, Northstar $ORG_A, Initech $ORG_B"

echo "3. User type and users"
create /user-types "$(jq -nc --arg o "$PARENT_OU" --arg s "$SUFFIX" '{handle:("customer-"+$s), displayName:"Customer", ouId:$o,
  schema:{username:{type:"string", unique:true}, password:{type:"string", credential:true}, email:{type:"string"},
  given_name:{type:"string"}, family_name:{type:"string"}}}')" >/dev/null
mkuser() {
  create /users "$(jq -nc --arg o "$1" --arg u "$2" --arg g "$3" --arg s "$SUFFIX" \
    '{type:("customer-"+$s), ouId:$o, attributes:{username:$u, password:env.TEST_PASSWORD, email:($u+"@example.com"), given_name:$g, family_name:"Tester"}}')"
}
USER_A="$(mkuser "$ORG_A" "alice-$SUFFIX" Alice)"
USER_B="$(mkuser "$ORG_B" "bob-$SUFFIX" Bob)"
USER_C="$(mkuser "$PARENT_OU" "carol-$SUFFIX" Carol)"
# Carol lives in the parent OU and is shared into both organizations, so she can switch between them.
api POST "/users/$USER_C/sharing-policies" "$(jq -nc --arg a "$ORG_A" --arg b "$ORG_B" \
  '{childUnits:{mode:"selected", units:[{ouId:$a, reach:"unit"}, {ouId:$b, reach:"unit"}]}}')" >/dev/null

echo "4. Device grant flow and application $CLIENT_ID"
# The device code grant needs a DEVICE_GRANT flow on the application, and its CALL node must target the
# same authentication flow as the application's authFlowId. Copy the default one and point it there.
DEVICE_FLOW="$(create /flows "$(api GET "/flows/$DEFAULT_DEVICE_FLOW" | jq -c --arg o "$PARENT_OU" --arg a "$AUTH_FLOW" --arg s "$SUFFIX" '
  {name:("Auth Playground Device Flow " + $s), handle:("auth-playground-device-" + $s), flowType, ouId:$o,
   nodes:(.nodes | map(if .type == "CALL" then .flow.ref = $a else . end))}')")"
echo "   device grant flow $DEVICE_FLOW"
APP_ID="$(create /applications "$(jq -nc --arg o "$PARENT_OU" --arg c "$CLIENT_ID" --arg r "$REDIRECTS" --arg l "$POST_LOGOUT" \
  --arg a "$AUTH_FLOW" --arg d "$DEVICE_FLOW" '
  {name:("Auth Playground (" + $c + ")"), ouId:$o, type:"browser", authFlowId:$a, deviceGrantFlowId:$d,
   inboundAuthConfig:[{type:"oauth2", config:{
     clientId:$c, redirectUris:($r | split(" ") | map(select(. != ""))), postLogoutRedirectUris:($l | split(" ") | map(select(. != ""))),
     grantTypes:["authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:token-exchange",
                 "urn:ietf:params:oauth:grant-type:device_code"],
     responseTypes:["code"], pkceRequired:true, tokenEndpointAuthMethod:"none", publicClient:true,
     scopes:["openid","profile","email","device_sso"],
     scopeClaims:{profile:["given_name","family_name"], email:["email"]},
     token:{accessToken:{userConfig:{attributes:["email","given_name","family_name","ouId","ouName","ouHandle","roles"]}},
            idToken:{userAttributes:["email","given_name","family_name","ouId","ouName","ouHandle"]}},
     userInfo:{userAttributes:["email","given_name","family_name","ouId","ouName","ouHandle"]}}}]}')")" || {
  exit 1
}
# Share the application with every organization beneath its OU, so users there can sign in to it.
api POST "/applications/$APP_ID/sharing-policies" '{"childUnits":{"mode":"all"}}' >/dev/null

echo "5. Confidential application $CLIENT_ID-m2m (client credentials, token exchange)"
M2M="$(api POST /applications "$(jq -nc --arg o "$PARENT_OU" --arg c "$CLIENT_ID-m2m" '
  {name:("Auth Playground M2M (" + $c + ")"), ouId:$o, type:"m2m",
   inboundAuthConfig:[{type:"oauth2", config:{clientId:$c, publicClient:false, tokenEndpointAuthMethod:"client_secret_post",
     grantTypes:["client_credentials","urn:ietf:params:oauth:grant-type:token-exchange"], scopes:["api:read","api:write"]}}]}')")"
M2M_ID="$(jq -er .id <<<"$M2M")"
M2M_SECRET="$(jq -er '.inboundAuthConfig[0].config.clientSecret' <<<"$M2M")"

# Create the file readable by the owner only from the start, not after it has been written.
umask 077
cat >"$ENV_FILE" <<EOF
BASE="$BASE"
CLIENT_ID="$CLIENT_ID"
APP_ID="$APP_ID"
PARENT_OU="$PARENT_OU"
ORG_A="$ORG_A"
ORG_B="$ORG_B"
USER_A="alice-$SUFFIX"
USER_B="bob-$SUFFIX"
USER_C="carol-$SUFFIX"
TEST_PASSWORD="$TEST_PASSWORD"
DEVICE_FLOW="$DEVICE_FLOW"
M2M_APP_ID="$M2M_ID"
M2M_CLIENT_ID="$CLIENT_ID-m2m"
M2M_CLIENT_SECRET="$M2M_SECRET"
EOF
chmod 600 "$ENV_FILE"
echo
echo "Done. Issuer $BASE, client ID $CLIENT_ID (public, PKCE, device code grant)."
echo "Confidential client $CLIENT_ID-m2m (client_secret_post); its secret is in $ENV_FILE."
echo "Organizations: Northstar Labs $ORG_A, Initech $ORG_B."
echo "Users (password in $ENV_FILE): alice-$SUFFIX (Northstar), bob-$SUFFIX (Initech), carol-$SUFFIX (Customers, shared into both)."
