# Auth Playground

A browser-only OAuth 2.0 and OpenID Connect test bench, built first for [ThunderID](https://thunderid.dev) and usable with any standards-based server. Inspired by OIDC Debugger, with token operations, organization (B2B) testing and a full HTTP log.

Live: <https://auth.playground.yeshandev.com>

## What it does

- **Authorization Code with PKCE**: discovery, configurable endpoints, scopes (with chips from `scopes_supported`), RFC 8707 resources, prompt, max_age, login_hint, acr_values, ui_locales and any extra parameter. A live preview explains every parameter.
- **Callback checks**: single-use state, `iss` (RFC 9207), automatic code exchange, errors explained in plain words. The code is removed from the address bar at once.
- **Tokens**: decoded access, ID and refresh tokens; JWKS signature check (RS, PS, ES, EdDSA); ID token checks (iss, aud, azp, exp, nbf, iat, nonce, at_hash, c_hash); claim descriptions and times.
- **Operations**: refresh, UserInfo (GET or POST), introspection, revocation (confirmed by introspection), RP-initiated logout.
- **Organizations (B2B)**: sign in to an organization, redeem at its token endpoint, silent switch with `prompt=none`, device-secret switch by token exchange, list the user's organizations, and compare claims between any two token sets.
- **HTTP log**: every request and response, secrets masked unless revealed, copy as curl.
- **Saved configurations** in `localStorage`, with import and export. Client secrets are never saved.

## Security model

- Configurations hold no secrets. Secrets typed for confidential test clients live in memory for the tab only.
- Tokens and the HTTP log live in `sessionStorage`: this tab only, gone when it closes.
- State, nonce and the PKCE verifier are random per request and single use.
- Back-channel calls omit cookies. Pages send no Referer and carry a strict Content-Security-Policy (scripts from this origin only).
- Nothing is sent anywhere except the servers you configure. No analytics, no backend.

Use test clients and test users. A browser is not the place for production client secrets.

## Using it with ThunderID

1. **Allow the playground's origin** in the server-wide CORS list. On the standalone (gateway) server the list is set by file, not by API: create `config/resources/server_configs/cors.yaml` in the server folder and restart.

   ```yaml
   resource_type: server_config
   name: cors
   value:
     allowedOrigins:
       - "https://auth.playground.yeshandev.com"
       - "http://localhost:5173"
   ```

2. **Create a browser application**: public client, token endpoint authentication `none`, PKCE required, grants `authorization_code` and `refresh_token` (add token exchange for the device-secret switch). Redirect URI `https://auth.playground.yeshandev.com/callback`, post-logout redirect URI `https://auth.playground.yeshandev.com/`. For organizations, add `ouId`, `ouName` and `ouHandle` to the access token attributes and share the application with the organizations.

3. In the playground, enter the issuer (for example `https://localhost:8090`), press **Discover**, enter the client ID and sign in.

`scripts/thunderid-setup.sh` does steps 1 and 2 against a running server. It also creates two organizations and test users:

```bash
BASE=https://localhost:8090 ADMIN_PASSWORD='<admin password>' PACK_DIR=/path/to/thunderid ./scripts/thunderid-setup.sh
```

### Local server notes

- A local ThunderID uses a self-signed certificate. Open the server URL in a tab and trust it once, or run the server with `server.http_only: true` for local testing.
- Chrome asks for permission before a public site (the hosted playground) calls `localhost`. Allow it, or run the playground locally (`npm run dev`).

### ThunderID behaviour to know

| Topic | Behaviour |
|---|---|
| Token endpoint and CORS | `/oauth2/token` answers no preflight, so `client_secret_basic` (an `Authorization` header) cannot be used from a browser. Use `none` or `client_secret_post`. |
| PKCE | `S256` only. |
| Response mode | `query` only. |
| Organizations | Selected by path: `/ou/{ouId}/oauth2/authorize` and `/ou/{ouId}/oauth2/token`. |
| Organization token endpoint | Accepts authorization code, client credentials and token exchange (device secret only). Refresh goes to `/oauth2/token`; the refresh token keeps the organization. |
| Shared applications | A sign-in to a shared application must decide the organization. Without an OU resolver in the flow, a sign-in at `/oauth2/authorize` is refused with `access_denied`. |
| Silent switch | `prompt=none` reuses the SSO session when the flow keeps one; responses forbid framing, so the playground uses a top-level redirect. |
| Revocation | Answers 200 for unknown tokens too; the playground confirms with introspection. |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the research, the backend matrix and the design.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run lint
npm run build    # dist/, with / and /callback/ entries
```

The app is static. `.github/workflows/deploy.yml` builds and publishes it to GitHub Pages on every push to `main`; `public/CNAME` sets the custom domain. Set `BASE_PATH=/repo-name/` when building for a project page without a custom domain.

## Roadmap

Client credentials, device authorization, token exchange, CIBA, PAR, DPoP, `private_key_jwt`, shareable configuration links, and an optional self-hosted relay for servers without CORS.
