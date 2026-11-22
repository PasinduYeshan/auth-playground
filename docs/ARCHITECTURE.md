# Auth Playground: research, architecture and plan

Auth Playground is a browser-only OAuth 2.0 and OpenID Connect test bench for any standards-based server. Provider-specific behaviour lives in presets (`src/lib/oauth/presets.ts`) that only fill defaults; ThunderID is the first preset and the server the playground is verified against. It is hosted as static files (GitHub Pages, `auth-playground.yeshandev.com`).

## 1. Research

### OIDC Debugger (oidcdebugger.com)

What it does well: one form (authorize URI, redirect URI, client ID, scope, state, nonce, response type and mode, PKCE), a `/debug` redirect page that shows what came back, and a client-side PKCE code exchange. Settings persist in `localStorage`.

Gaps that this project fills:

- No discovery, no endpoint autofill, no scope suggestions.
- No ID token signature or claim validation (iss, aud, exp, nonce, at_hash).
- No refresh, UserInfo, introspection, revocation or logout.
- No client authentication (secret basic or post), no extra parameters (prompt, max_age, claims, resource).
- No view of the raw HTTP requests and responses.
- `form_post` responses pass through its server, so a public instance sees those codes.
- Small bugs: values containing `=` are cut short, and form validation is inconsistent.

### ThunderID (verified on `main` at 051a92c76, and on a running pack)

| Topic | Behaviour | Effect on the playground |
|---|---|---|
| Discovery | `/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server` at the root only. Issuer = base URL, no path (`https://localhost:8090`). | Discovery autofills every endpoint. |
| Response type and mode | `code` only; `response_mode` `query` only. | Hybrid and implicit are not offered. `form_post` is shown with a warning (a static site cannot receive a POST). |
| PKCE | `S256` only; `plain` is refused. Required for public clients. | S256 is the default; `plain` stays selectable to test refusals. |
| Authorization response | Sends `iss` (RFC 9207, advertised). | The callback checks `iss` against the issuer. |
| `resource` (RFC 8707) | Several on authorize; at most one at the token endpoint (`invalid_target` otherwise). `aud` = the resource server's identifier. | Several resources on authorize; only the first one is sent on the token request. |
| Client authentication | `client_secret_basic`, `client_secret_post`, `private_key_jwt`, `none`. The method must equal the app's single configured method. | The client authentication method is a profile setting. |
| CORS | One server-wide origin list (`cors` server config). Default: none. The docs offer `PUT /server-config/cors`, but on the standalone (gateway) server deployment-wide writes are import-only, so the PUT is refused with 403 even for an admin (`sysauthz/ou_bounded_authz_service.go:157-175`). Use `config/resources/server_configs/cors.yaml` and restart. | The playground's origin must be added once per server, by file. The UI explains CORS failures. |
| CORS preflight | `/oauth2/token` and `/oauth2/par` have **no OPTIONS route** (405). Introspect, revoke, userinfo, jwks, logout and `/users/me/ous` have one. | Token calls must be "simple" requests: form body, no `Authorization` header. So `client_secret_basic` and DPoP fail at the token endpoint in a browser. |
| Tokens | All are JWTs (`typ` `at+jwt`, `rt+jwt`). Refresh rotates and revokes the previous one; replay revokes the family. | The decoder shows both. The refresh view links each set to its parent. |
| Introspection | Any registered client, public included (method `none`). | Works from the browser with the same public client. |
| Revocation | Own tokens only; 200 on success and on unknown tokens. Revokes the token family when present. | The status is confirmed by introspection after a revoke. |
| UserInfo | GET and POST, `Authorization: Bearer` only. JSON or `application/jwt`. Needs `openid`. | Bearer header (preflight is supported). |
| Organization token endpoint | Refuses `refresh_token` ("not supported on the organization unit scoped token endpoint"). | Refresh always goes to `/oauth2/token`; the refresh token keeps the OU. |
| Shared apps | Sign-in at `/oauth2/authorize` to an app shared with child OUs, whose flow has no OU resolver, ends in `access_denied` ("did not determine an organization unit"). | Shown as an error with its explanation; use an organization sign-in. |
| Organizations | An organization is an OU. Sign-in to an OU at `/ou/{ouId}/oauth2/authorize`, redeem at `/oauth2/token` or `/ou/{ouId}/oauth2/token`. No org parameter, no org-switch grant. Switching = a new sign-in to the other OU (silent with `prompt=none` when the SSO session allows it), or exchanging a `device_secret` (scope `device_sso`) at `/ou/{ouId}/oauth2/token` with token exchange. `GET /users/me/ous` lists the user's OUs. Claims `ouId`, `ouName`, `ouHandle` when the app lists them. | B2B view built on templates: `{issuer}/ou/{org}/oauth2/authorize` and `/token`. Template-based, so other servers (path or parameter styles) fit too. |
| Framing | Responses carry `X-Frame-Options: DENY`. | No hidden-iframe silent sign-in: a "silent" switch is a top-level `prompt=none` redirect. |
| PAR (RFC 9126) | `/oauth2/par`, advertised in discovery. No OPTIONS route, but a form POST from a public client is a simple request and the response carries the CORS headers. `request_uri` lasts 60 seconds. There is no organization PAR endpoint. | PAR is a step in the Authorize view, with the expiry counted down. |
| DPoP, JAR | DPoP supported but the `DPoP` header is not in the allowed CORS headers; JAR not supported. | Future work; DPoP needs a server change or a proxy. |

## 2. What needs a backend

| Operation | Browser-only? | Why |
|---|---|---|
| Discovery, JWKS | Yes | CORS on, no credentials. |
| Authorization request | Yes | Top-level navigation, no CORS. |
| Code exchange and refresh (public client, `none`) | Yes, once the origin is allowed | Simple form POST. |
| Code exchange and refresh (`client_secret_post`) | Yes, once the origin is allowed | Works, but the secret is in the browser. Allowed for testing only, held in memory, never saved. |
| `client_secret_basic` at the token endpoint | **No on ThunderID** | The `Authorization` header forces a preflight and `/oauth2/token` has no OPTIONS route. Works on servers that answer preflight. |
| `private_key_jwt` | Possible later | Key in the browser (WebCrypto, non-extractable) is fine for test keys. |
| UserInfo, introspection, revocation | Yes, once the origin is allowed | Preflight supported. |
| `form_post` response mode | **No** | A static site cannot receive a POST. Needs a tiny callback function. |
| DPoP | **No on ThunderID** today | `DPoP` is not an allowed CORS header. |
| Servers with no CORS at all | **No** | Needs an optional relay (see 3.4). |

## 3. Architecture

### 3.1 Stack

React 19, TypeScript, Vite, Tailwind CSS 4, Vitest. No runtime dependencies beyond React and an icon set: all protocol code uses `fetch` and Web Crypto, so there is nothing to audit in the token path.

### 3.2 Layers

```
src/lib/oauth/      protocol core, framework-free and unit tested
  encoding.ts       base64url, random, sha256
  pkce.ts           RFC 7636
  http.ts           tracedFetch: records every request and response for the HTTP log
  discovery.ts      OIDC Discovery and RFC 8414, JWKS
  authorize.ts      request builder, PAR (RFC 9126), pending-transaction store, callback parser and checks
  client.ts         token grants, client authentication, UserInfo, introspection, revocation, logout URL
  jwt.ts            decode, Web Crypto signature check, ID token and access token claim checks
  b2b.ts            organization endpoints (path templates or a parameter), org claims, token-exchange switch, claim diff
  presets.ts        provider presets: defaults and notes only, no protocol code
  types.ts          Profile (saved, no secrets), TokenSet, SessionSecrets
src/lib/store/      profiles (localStorage), token sets and unredeemed codes (sessionStorage), app store
src/components/     shared UI: token viewer, HTTP exchange view, form controls
src/views/          Configure, Authorize, Callback, Other grants, Tokens, Organizations, Compare, HTTP log
```

The authorization code flow runs as separate steps, each started by the user: build the request (regenerate at will), push it to the PAR endpoint when the configuration asks for PAR (the browser then carries only `client_id` and `request_uri`), sign in, then check the response on the callback page. The checked code is kept in `sessionStorage` until the user redeems it, copies the token request as curl (the client secret left as `$CLIENT_SECRET`), or discards it; it is removed once a redemption is attempted, since a code is single use. "Redeem the code automatically" restores the one-step behaviour.

Grants without a redirect (client credentials, device authorization, token exchange) are functions in `lib/oauth/client.ts` built on `tracedFetch` and `applyClientAuth`, shown in the Other grants view; their tokens become ordinary token sets. Future grants (CIBA) follow the same pattern.

### 3.3 Security model

- **No secrets at rest.** A `Profile` has no secret fields. `sanitizeProfile` drops unknown fields and secret-looking extra parameters on save, import and export. Client secrets live in memory only and are gone on reload.
- **Tokens** live in `sessionStorage` (this tab only, cleared when it closes) so they survive the redirect. A "Clear" button wipes them.
- **State, nonce and PKCE verifier** are random per request (Web Crypto), stored under the state value and removed on first use (single use, 30-minute lifetime). The callback refuses a missing or unknown state and checks `iss` (RFC 9207).
- **ID tokens** are verified against the JWKS (RS, PS, ES and EdDSA) and their claims checked (iss, aud, azp, exp, nbf, iat, nonce, at_hash, c_hash).
- **Back-channel calls** use `credentials: 'omit'` and `cache: 'no-store'`.
- **The page** sends `Referrer-Policy: no-referrer` (meta), so codes in the callback URL do not leak in the Referer header. The callback removes the code from the address bar right away (`history.replaceState`).
- **Display**: secrets and tokens are masked in the HTTP log unless "Reveal" is on.
- Nothing is sent to any server other than the ones the user configures. No analytics.

### 3.4 Extensibility toward a backend

`tracedFetch` is the single network seam. A later optional relay (a small Cloudflare Worker or similar, self-hosted by the user) can be added as a transport setting without touching the grant code. It would cover servers with no CORS, `client_secret_basic` on ThunderID, `form_post` and DPoP. It stays opt-in and never stores data.

### 3.5 Routing and hosting

Two HTML entries, `/` and `/callback/`, load the same bundle, so the redirect URI `https://auth-playground.yeshandev.com/callback` is a real file on GitHub Pages (no 404 fallback). A GitHub Actions workflow builds and deploys. `public/CNAME` sets the custom domain.

## 4. Plan

**Phase 1 (this MVP)**

1. Protocol core with unit tests (done first, so the UI sits on tested code).
2. Configure: profiles, discovery, endpoints, client, request parameters, extra parameters, import and export.
3. Authorize: live request preview, parameter table, start.
4. Callback: state and `iss` checks, automatic code exchange, errors explained.
5. Tokens: token sets, decoded JWTs, signature and claim checks, refresh, UserInfo, introspection, revocation, logout.
6. Organizations: org list (manual or a configurable list endpoint), sign-in to an org (interactive or `prompt=none`), token-exchange switch with a configurable subject token, org-scoped code redemption, compare claims between sets.
7. HTTP log with masking and "copy as curl".
8. End-to-end test against a local ThunderID with two OUs and a shared public app.
9. GitHub Pages workflow.

**Later**: CIBA, PAR, DPoP (via relay or a server change), `private_key_jwt`, optional relay, shareable configuration links.

## 5. ThunderID setup for the playground

1. Allow the playground's origin (once per server) with `config/resources/server_configs/cors.yaml`, then restart:

   ```yaml
   resource_type: server_config
   name: cors
   value:
     allowedOrigins:
       - "https://auth-playground.yeshandev.com"
       - "http://localhost:5173"
   ```

2. Create a browser application: public client, `tokenEndpointAuthMethod: none`, `pkceRequired: true`, grants `authorization_code` and `refresh_token` (add token exchange for the device-secret switch; add the device code grant with a device grant flow, `deviceGrantFlowId`, whose authentication call matches the app's `authFlowId`), redirect URI `https://auth-playground.yeshandev.com/callback`, post-logout redirect URI `https://auth-playground.yeshandev.com/`. Add `ouId`, `ouName`, `ouHandle` to the access token attributes for B2B, and map scopes to claims (`scopeClaims`) so UserInfo returns more than `sub`.
3. For B2B, share the application with the child OUs (`POST /applications/{id}/sharing-policies {"childUnits":{"mode":"all"}}`; a `sharingPolicies` field in the create request is ignored).

`scripts/thunderid-setup.sh` does all of this against a local server.

## 6. Verification

Unit tests (Vitest) cover PKCE (RFC 7636 vector), JWT decode and RS256/ES256 verification with tampering, ID token claim checks, the authorization request builder, callback state and `iss` checks, client authentication encoding, discovery URLs, profile sanitizing, organization endpoints and the claim diff.

End to end against ThunderID `main` (051a92c76), in a browser, with the production build:

| Scenario | Result |
|---|---|
| Discovery from `http://localhost:9190` | All endpoints and scopes loaded |
| Sign-in at `/oauth2/authorize` for a shared app | `access_denied`, state and `iss` checked, explained |
| Sign-in to an organization (`/ou/{id}/oauth2/authorize`), code redeemed at `/ou/{id}/oauth2/token` from the browser | 200; `ouId`/`ouName`/`ouHandle` name the organization; device secret returned |
| Access and ID token signature (JWKS) and ID token nonce | Verified |
| UserInfo (Bearer, CORS preflight) | 200 |
| Introspection with the public client | `active: true` |
| Refresh at the organization endpoint | Refused by the server (see above); fixed to use `/oauth2/token`, then 200 and the organization kept |
| Revocation, then introspection | 200, then `active: false` |
| `GET /users/me/ous` | Lists the user's organizations, marks the current one |
| Device-secret switch to another organization | 200, new tokens for that organization |
| Compare claims between organizations | `ouId`, `ouName`, `ouHandle`, `grant_type`, `scope` differ |
| Silent switch (`prompt=none`) with an SSO session | Code issued with no screen |
| RP-initiated logout, then silent switch | Logout state matched; then `login_required` |
| Client credentials with a confidential (`m2m`) client, `client_secret_post` | 200, access token for the client |
| Token exchange: client credentials access token as subject | 200, `issued_token_type` access token |
| PAR at `/oauth2/par` with the public client, then sign-in with `client_id` and `request_uri` only | 201 with `request_uri` (60 s); the server resolved it and showed its sign-in page |
| PAR, then sign-in to an organization at `/ou/{id}/oauth2/authorize` | Code issued; redeemed at the organization's token endpoint, `ouName` names the organization |
| Code kept on the callback page, redeemed later from Authorize | 200, token set stored |
| Token request copied as curl, run from a shell | 200 with tokens |
| Automatic redemption, and the plain flow with PAR off | 200 in both |
| Device authorization at `/oauth2/device-authorize`, user code approved at `/gate/device`, polling | `authorization_pending` while waiting, then 200 with access, ID and refresh tokens; signature verified |
