# Agent instructions

Auth Playground is a browser-only OAuth 2.0 and OpenID Connect test bench for any standards-based authorization server. It is a static React app with no backend, hosted on GitHub Pages at <https://auth-playground.yeshandev.com>. ThunderID is one provider preset and the server it is tested against. It is not the product's identity.

Read `README.md` for what the app does and `docs/ARCHITECTURE.md` for the research, the backend matrix, the design and the verified server behaviour.

## Commands

```bash
npm install
npm run dev      # http://localhost:5173 (strict port: the redirect URI and server CORS lists depend on it)
npm test         # Vitest unit tests
npm run lint     # oxlint
npm run build    # tsc -b, then vite build into dist/ with / and /callback/ entries
```

Run `npm run lint`, `npm test` and `npm run build` before every commit. The `only-export-components` and `purity` lint warnings already in the codebase are known; don't add new ones.

## Layout

| Path | What lives there |
|---|---|
| `src/lib/oauth/` | Protocol core, with no React: `http.ts` (`tracedFetch`, masking), `authorize.ts` (request, PAR, callback), `client.ts` (token endpoint grants, UserInfo, introspection, revocation, logout), `discovery.ts`, `jwt.ts` (decode, WebCrypto verification, ID token checks), `pkce.ts`, `b2b.ts` (organizations), `presets.ts`, `types.ts` |
| `src/lib/flows.ts` | Joins the protocol core to the store. Views call these functions. `errors.ts` holds plain-language hints for OAuth error codes |
| `src/lib/store/` | `appStore.ts` (an external store read with `useAppState`), `profiles.ts` (saved configurations, file import and export), `tokens.ts` |
| `src/views/` | One file per tab: Authorize, Other grants (`GrantsView`), Tokens, Organizations, Compare, HTTP log; plus `ConfigPanel` and `CallbackView` |
| `src/components/` | Shared UI (`ui.tsx`), `TokenViewer`, `HttpExchangeView`, `ReceivedCodeCard` (redeem, copy or discard a code) |
| `src/lib/oauth/__tests__/` | Unit tests |
| `scripts/thunderid-setup.sh` | Prepares a ThunderID server with organizations, users and clients for every flow |
| `docs/screenshots/` | README images |

## Rules that keep the app correct and safe

- **No backend, ever.** Everything runs in the browser. If a feature seems to need a server, write it down in `docs/ARCHITECTURE.md` as a limit instead of adding one.
- **Never persist secrets.** Saved configurations (`localStorage`) and exported files never hold a client secret. Secrets live in memory only (`setSecrets`, or component state). Tokens and the HTTP log live in `sessionStorage`. `sanitizeProfile` and the export tests enforce this: keep them passing and extend them when the profile changes.
- **Parse and call endpoints through `lib/oauth/url.ts`** (`isHttpUrl`, `requireHttpUrl`, `displayUrl`), never `new URL` on a configured value during render: endpoints are saved on every keystroke and are often incomplete.
- **Every network call goes through `tracedFetch`** so it shows in the HTTP log, with `credentials: 'omit'`. Add new secret-bearing form fields or response fields to `SENSITIVE_FIELDS` in `http.ts` so they are masked; a new kind of client secret also goes in `redact.ts`, which redacts the saved log and curl copies.
- **Keep token endpoint calls simple CORS requests** (a form POST with no custom headers) where possible. Some servers, ThunderID among them, answer no preflight on the token endpoint, so a header such as `Authorization` (`client_secret_basic`) or `DPoP` fails from a browser.
- **The CSP allows scripts from this origin only.** No CDNs, analytics, external fonts or remote images. Add libraries as npm dependencies so they are bundled.
- **Stay provider-neutral.** Wording, defaults and the UI must work for any server. Put server-specific behaviour in a preset (`presets.ts`: defaults, notes, B2B templates) and in the README's provider notes, never as hard-coded branches.
- **Protocol hygiene:** PKCE S256; state, nonce and verifier random per request and single use; check `iss` (RFC 9207) and the ID token claims; remove the code from the address bar at once. Follow the RFC in question and name it in comments and UI text.
- Each step of a flow runs when the user chooses (push, sign in, redeem), with any automatic chaining behind a setting. Keep it that way for new flows.
- New grants follow the existing pattern: a function in `lib/oauth/client.ts` on top of `tracedFetch` and `applyClientAuth`, store tokens through `flows.ts` (`storeGrantTokens` or `newTokenSet`) so every token operation works on them, then add UI and a unit test for the request it builds.

## Code style

- TypeScript strict, React 19 function components, Tailwind 4. Custom classes in `src/index.css` are defined with `@utility` (Tailwind 4 cannot `@apply` its own custom classes).
- `useAppState(selector)` compares results shallowly, so a selector may build arrays and objects. Don't call `Date.now()` or other impure functions during render.
- Comments explain why. User-facing text is plain and short, and says what happened and what to do.

## Testing against a real server

Unit tests are not enough for protocol changes. Check the change in a browser against a real server, which can be a local ThunderID:

1. Start a ThunderID server. A local one uses a self-signed certificate; `server.http_only: true` in `deployment.yaml` avoids that for local testing.
2. Run `scripts/thunderid-setup.sh` (see its header for variables; `CONSOLE_REDIRECT` must match the Console's registered redirect URI, `PACK_DIR` lets it write `cors.yaml`). It creates two organizations, three users, a public browser client (authorization code, refresh, token exchange, device code, with a device grant flow) and a confidential `-m2m` client (client credentials, token exchange). IDs and test passwords go to `scripts/.thunderid-env`, which is git-ignored and mode 600. Never commit it or paste its values into chat, commits or docs.
3. Restart the server if the script wrote `cors.yaml`, run `npm run dev`, choose the ThunderID preset, enter the base URL and press **Discover**.

Use test clients and test users only. Device codes expire after 10 minutes, so approve one promptly.

ThunderID behaviour the app depends on is in the table in `docs/ARCHITECTURE.md` and in the README's provider notes. When you find new behaviour, add it there.

## Docs to keep in step

- `README.md`: the feature list, provider notes, security model and roadmap.
- `docs/ARCHITECTURE.md`: the design, and the table of scenarios verified end to end.
- `scripts/thunderid-setup.sh`: when a flow needs new server configuration.

## Git and deployment

- **Pushing to `main` deploys** the site (`.github/workflows/deploy.yml` publishes to GitHub Pages; `public/CNAME` sets the domain). Don't push, and don't trigger workflows, unless the maintainer asks.
- Pages must stay on the GitHub Actions build type. Changing the custom domain in the repository settings can switch Pages to deploy from the branch and add a root `CNAME` file; switch it back and delete that file.
- Commit messages: an imperative subject and a short body that says what changed and why. Add no AI co-author or attribution lines.
- This is a public repository. Never link private issues, repositories or internal URLs.
