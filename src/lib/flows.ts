// Orchestration: ties the protocol core to the app store. Views call these; nothing here renders.
import { buildAuthorizationRequest, callbackFromRaw, checkCallback, hasPending, parseCallback, prunePending, pushAuthorizationRequest, savePending, takePending, withPushedRequest, type AuthorizationRequest, type BuildOptions, type CallbackCheck, type CallbackParams, type ParResult, type PendingAuthorization, type ReceivedCode } from './oauth/authorize'
import { exchangeForOrganization, orgEndpoints, orgTokenEndpoint, switchSubjectToken } from './oauth/b2b'
import { applyClientAuth, codeExchangeForm, refresh, toGrantResult, type ClientCredentials, type GrantResult } from './oauth/client'
import { discover, fetchJwks } from './oauth/discovery'
import { encodeForm, tracedFetch } from './oauth/http'
import { requireHttpUrl } from './oauth/url'
import { listenForResponses } from './handoff'
import type { Jwks } from './oauth/jwt'
import { toCurl } from './oauth/redact'
import type { GrantKind, Organization, Profile, TokenResponse, TokenSet } from './oauth/types'
import { addCode, addTokenSet, getState, removeCode, secretsFor, setState, updateProfile, updateSignIn, upsertSignIn } from './store/appStore'

export function credentialsFor(profile: Profile): ClientCredentials {
  return { clientId: profile.clientId, method: profile.clientAuthMethod, clientSecret: secretsFor(profile.id).clientSecret }
}

/** The configuration a token set came from. Operations never fall back to another configuration:
 * its endpoints belong to a different server. */
export function profileOf(set: TokenSet): Profile {
  const profile = getState().profiles.find((p) => p.id === set.profileId)
  if (!profile) throw new Error('The configuration this token set came from was deleted, so its server and client are unknown.')
  return profile
}

/** The configuration's machine client: a confidential client for grants with no user. */
export function machineCredentialsFor(profile: Profile): ClientCredentials {
  return { clientId: profile.machineClientId.trim(), method: profile.machineAuthMethod, clientSecret: secretsFor(profile.id).machineClientSecret }
}

/** The client a token set was issued to: the sign-in client, the machine client, or another client. */
export function credentialsForSet(set: TokenSet, profile: Profile): ClientCredentials {
  if (!set.client || set.client.clientId === profile.clientId) return credentialsFor(profile)
  if (set.client.clientId === profile.machineClientId.trim()) return machineCredentialsFor(profile)
  return { clientId: set.client.clientId, method: set.client.method, clientSecret: getState().otherClientSecrets[set.client.clientId] }
}

export function introspectionCredentialsFor(profile: Profile): ClientCredentials {
  if (!profile.introspectionClientId) return credentialsFor(profile)
  return {
    clientId: profile.introspectionClientId,
    method: profile.introspectionAuthMethod,
    clientSecret: secretsFor(profile.id).introspectionClientSecret,
  }
}

/** The issuer to save: the metadata's exact value (tokens carry it byte for byte, trailing slash
 * included) unless the user typed a different one, which discovery then warns about. */
export function discoveredIssuer(input: string, metadataIssuer: string): string {
  const typed = input.trim()
  if (!typed || typed.includes('/.well-known/')) return metadataIssuer
  const strip = (v: string) => v.replace(/\/+$/, '')
  return strip(typed) === strip(metadataIssuer) ? metadataIssuer : strip(typed)
}

export async function runDiscovery(profile: Profile): Promise<{ error?: string; warnings: string[] }> {
  const result = await discover(profile.issuer)
  if (!result.metadata) return { error: result.error, warnings: [] }
  const m = result.metadata
  setState((s) => ({ metadata: { ...s.metadata, [profile.id]: m } }))
  updateProfile(profile.id, {
    issuer: discoveredIssuer(profile.issuer, m.issuer),
    expectIss: m.authorization_response_iss_parameter_supported === true,
    endpoints: {
      authorization: m.authorization_endpoint ?? '',
      token: m.token_endpoint ?? '',
      userinfo: m.userinfo_endpoint ?? '',
      introspection: m.introspection_endpoint ?? '',
      revocation: m.revocation_endpoint ?? '',
      jwks: m.jwks_uri ?? '',
      endSession: m.end_session_endpoint ?? '',
      deviceAuthorization: m.device_authorization_endpoint ?? '',
      par: m.pushed_authorization_request_endpoint ?? '',
    },
  })
  if (m.jwks_uri) void loadJwks(profile.id, m.jwks_uri)
  return { warnings: result.warnings }
}

// One JWKS fetch at a time per configuration: StrictMode and several viewers would otherwise each fetch.
const jwksInFlight = new Map<string, Promise<Jwks | undefined>>()

export function loadJwks(profileId: string, uri: string): Promise<Jwks | undefined> {
  if (!uri) return Promise.resolve(undefined)
  const key = `${profileId} ${uri}`
  const running = jwksInFlight.get(key)
  if (running) return running
  const p = fetchJwks(uri)
    .then(({ jwks }) => {
      if (jwks) setState((s) => ({ jwks: { ...s.jwks, [profileId]: jwks }, jwksUri: { ...s.jwksUri, [profileId]: uri } }))
      return jwks
    })
    .finally(() => jwksInFlight.delete(key))
  jwksInFlight.set(key, p)
  return p
}

/** The cached JWKS, fetched again when the configuration's JWKS URI changed since. */
export async function ensureJwks(profile: Profile): Promise<Jwks | undefined> {
  const s = getState()
  if (s.jwks[profile.id] && s.jwksUri[profile.id] === profile.endpoints.jwks) return s.jwks[profile.id]
  return loadJwks(profile.id, profile.endpoints.jwks)
}

// Refetch at most once a minute per configuration: a token signed with a key the server never
// published must not cause a fetch on every render.
const jwksRefetchedAt = new Map<string, number>()

/** A token names a key the cached JWKS lacks: the server may have rotated its keys, so fetch again. */
export async function refetchJwksForKid(profile: Profile): Promise<void> {
  const last = jwksRefetchedAt.get(profile.id) ?? 0
  if (Date.now() - last < 60_000) return
  jwksRefetchedAt.set(profile.id, Date.now())
  await loadJwks(profile.id, profile.endpoints.jwks)
}

/** Builds the request for a plain or organization sign-in. */
export function prepareAuthorization(profile: Profile, org?: Organization, extra: BuildOptions = {}) {
  if (!org) return buildAuthorizationRequest(profile, extra)
  const ep = orgEndpoints(profile, org)
  return buildAuthorizationRequest(profile, {
    ...extra,
    organization: org,
    authorizationEndpoint: ep.authorization,
    tokenEndpoint: ep.token,
    overrides: [...ep.params, ...(extra.overrides ?? [])],
    label: extra.label ?? `Sign in to ${org.name}`,
  })
}

/** Saves the transaction so the callback can complete it, whether the app navigates or the user
 * opens a copied authorization URL in this browser. */
export function rememberAuthorization(pending: PendingAuthorization): void {
  prunePending()
  savePending(pending)
}

/** Records a sign-in about to start (or a copied URL about to be opened) so its response is
 * accepted in this tab and shown in the Sign-ins list. */
export function startSignIn(pending: PendingAuthorization): void {
  rememberAuthorization(pending)
  upsertSignIn({
    id: pending.state,
    label: pending.label ?? (pending.organization ? `Sign in to ${pending.organization.name}` : 'Sign-in'),
    profileId: pending.profile.id,
    startedAt: Date.now(),
    status: 'waiting',
    viaPar: !!pending.par,
  })
}

export function newTokenSet(partial: Omit<TokenSet, 'id' | 'obtainedAt'>): TokenSet {
  return { id: crypto.randomUUID(), obtainedAt: Date.now(), ...partial }
}

/** Step 2 of a PAR run: pushes the previewed request and returns the transaction to redirect with. */
export async function pushAuthorization(req: AuthorizationRequest): Promise<{ result: ParResult; pending?: PendingAuthorization }> {
  const profile = getState().profiles.find((p) => p.id === req.pending.profile.id) ?? req.pending.profile
  // Organization sign-ins push to the same endpoint: RFC 9126 defines one per server.
  const result = await pushAuthorizationRequest(profile.endpoints.par, req.params, credentialsFor(profile))
  if (!result.requestUri) return { result }
  return { result, pending: withPushedRequest(req.pending, result.requestUri, result.expiresIn) }
}

export interface CallbackOutcome {
  callback?: CallbackParams
  pending?: PendingAuthorization
  check?: CallbackCheck
  /** The code, kept until the user redeems or discards it. */
  received?: ReceivedCode
  /** The automatic redemption, when the configuration asks for it. */
  redeeming?: Promise<RedeemOutcome>
  error?: string
}

export interface RedeemOutcome {
  grant?: GrantResult
  tokenSet?: TokenSet
  error?: string
}

/** Checks a response in the tab that holds its transaction, keeps the code and updates the sign-in.
 * Redeeming is a separate step unless the configuration redeems automatically. */
export function acceptResponse(callback: CallbackParams): CallbackOutcome {
  const pending = callback.state ? takePending(callback.state) : undefined
  const check = checkCallback(callback, pending)
  const id = callback.state ?? crypto.randomUUID()
  const known = getState().signIns.some((x) => x.id === id)
  const fail = (message: string) => {
    const entry = { status: 'failed' as const, message, finishedAt: Date.now() }
    if (known) updateSignIn(id, entry)
    else if (pending) upsertSignIn({ id, label: pending.label ?? 'Sign-in', profileId: pending.profile.id, startedAt: pending.createdAt, ...entry })
  }
  if (callback.error) {
    fail(`${callback.error}${callback.errorDescription ? `: ${callback.errorDescription}` : ''}`)
    return { callback, pending, check }
  }
  if (!check.ok || !callback.code || !pending) {
    fail(check.problems.join(' ') || 'The response has no code.')
    return { callback, pending, check }
  }
  const received: ReceivedCode = { id: pending.state, code: callback.code, receivedAt: Date.now(), pending }
  addCode(received)
  if (known) updateSignIn(id, { status: 'code', message: undefined, iss: !!callback.iss })
  else upsertSignIn({ id, label: pending.label ?? 'Sign-in', profileId: pending.profile.id, startedAt: pending.createdAt, status: 'code', viaPar: !!pending.par, iss: !!callback.iss })
  const profile = getState().profiles.find((p) => p.id === pending.profile.id) ?? pending.profile
  const redeeming = profile.redeemCodeAutomatically ? redeemCode(received) : undefined
  return { callback, pending, check, received, redeeming }
}

/** Starts listening for responses handed over from sign-in tabs. Call once per playground tab. */
export function listenForSignInResponses(): () => void {
  return listenForResponses(hasPending, (raw, source) => acceptResponse(callbackFromRaw(raw, source)))
}

/** The callback page when no playground tab took the response: completes it here. */
export function receiveCallback(location: Location): CallbackOutcome {
  const callback = parseCallback(location)
  if (!callback) return { error: 'This page expects an authorization response (code or error) in the URL.' }
  window.history.replaceState(null, '', location.pathname)
  return acceptResponse(callback)
}

/** The token request for a received code, ready to edit: URL, form fields and headers. Client
 * authentication is included, with the secret from memory. */
export interface TokenRequestDraft {
  url: string
  form: [string, string][]
  headers: [string, string][]
}

export function tokenRequestDraft(received: ReceivedCode): TokenRequestDraft {
  const { pending, code } = received
  const fields = codeExchangeForm({
    code,
    redirectUri: pending.profile.redirectUri,
    codeVerifier: pending.codeVerifier,
    resources: pending.profile.resources,
    extraParams: pending.profile.extraTokenParams,
  })
  const headers: Record<string, string> = {}
  // The client the request was made for (the snapshot); its secret lives in memory only. A missing
  // secret is left empty for the user to fill in rather than failing here.
  const creds = { ...credentialsFor(pending.profile), clientSecret: secretsFor(pending.profile.id).clientSecret }
  try {
    applyClientAuth(creds, fields, headers)
  } catch {
    if (creds.method === 'client_secret_basic') headers.Authorization = 'Basic '
    else Object.assign(fields, { client_id: creds.clientId, client_secret: '' })
  }
  return {
    url: pending.tokenEndpoint,
    form: Object.entries(fields).filter((e): e is [string, string] => e[1] !== undefined),
    headers: Object.entries(headers),
  }
}

/** The draft as curl. Client secrets are written as $CLIENT_SECRET so they never reach the clipboard. */
export function draftCurl(draft: TokenRequestDraft): string {
  return toCurl({
    method: 'POST',
    url: draft.url,
    headers: { ...Object.fromEntries(draft.headers), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encodeForm(draft.form),
  })
}

export function codeExchangeCurl(received: ReceivedCode): string {
  return draftCurl(tokenRequestDraft(received))
}

/** Sends a token request for a received code, as drafted (and possibly edited), and stores the result. */
export async function redeemCode(received: ReceivedCode, draft: TokenRequestDraft = tokenRequestDraft(received)): Promise<RedeemOutcome> {
  const { pending, code } = received
  let grant: GrantResult
  try {
    requireHttpUrl(draft.url, 'token endpoint')
    const exchange = await tracedFetch({
      label: 'Token: authorization_code',
      url: draft.url,
      form: draft.form,
      headers: Object.fromEntries(draft.headers.filter(([k]) => k.trim())),
    })
    grant = toGrantResult(exchange)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  // The code is single use: a failed redemption has most likely spent it too (RFC 6749 §4.1.2).
  // It stays in the list so the request can be sent again to see what the server does with a reused code.
  if (!grant.tokens) {
    const e = grant.error
    // Sending a spent code again is a test of the server: it does not undo a sign-in that got tokens.
    if (getState().signIns.find((x) => x.id === received.id)?.status !== 'redeemed')
      updateSignIn(received.id, { status: 'failed', message: e ? `${e.error}${e.error_description ? `: ${e.error_description}` : ''}` : `HTTP ${grant.exchange.response?.status ?? '?'}`, finishedAt: Date.now() })
    return { grant }
  }
  removeCode(received.id)
  const tokenSet = newTokenSet({
    label: pending.label ?? (pending.organization ? `Sign in to ${pending.organization.name}` : 'Authorization code'),
    grant: 'authorization_code',
    profileId: pending.profile.id,
    response: grant.tokens,
    nonce: pending.nonce,
    code,
    organization: pending.organization,
    tokenEndpoint: draft.url,
    maxAge: pending.profile.maxAge.trim() ? Number(pending.profile.maxAge) : undefined,
  })
  addTokenSet(tokenSet)
  updateSignIn(received.id, { status: 'redeemed', tokenSetId: tokenSet.id, message: undefined, finishedAt: Date.now() })
  return { grant, tokenSet }
}

/** RFC 6749 §6: the server may leave out a new refresh token (the old one stays valid), and OIDC Core
 * §12.2 lets it leave out the ID token. Keep both from the earlier set unless new ones came back. */
export function mergeRefreshResponse(previous: TokenResponse, next: TokenResponse): TokenResponse {
  const carried: TokenResponse = {}
  if (!next.refresh_token && previous.refresh_token) carried.refresh_token = previous.refresh_token
  if (!next.id_token && previous.id_token) carried.id_token = previous.id_token
  return { ...carried, ...next }
}

export async function refreshTokenSet(set: TokenSet, scope?: string): Promise<GrantResult> {
  const profile = profileOf(set)
  if (!set.response.refresh_token) throw new Error('This token set has no refresh token.')
  // By default refresh at the default token endpoint: some servers' organization token endpoints
  // accept no refresh grant, and the refresh token itself records the organization.
  const tokenEndpoint = profile.b2b.refreshAtOrgTokenEndpoint && set.tokenEndpoint ? set.tokenEndpoint : profile.endpoints.token
  const grant = await refresh({
    tokenEndpoint,
    creds: credentialsForSet(set, profile),
    refreshToken: set.response.refresh_token,
    scope: scope || undefined,
    resource: profile.resources[0],
    extraParams: profile.extraTokenParams,
  })
  if (grant.tokens) {
    addTokenSet(
      newTokenSet({
        label: `Refreshed: ${set.label}`,
        grant: 'refresh_token',
        profileId: set.profileId,
        response: mergeRefreshResponse(set.response, grant.tokens),
        // A carried-over ID token still belongs to the original request's nonce.
        nonce: grant.tokens.id_token ? undefined : set.nonce,
        code: grant.tokens.id_token ? undefined : set.code,
        client: set.client,
        organization: set.organization,
        tokenEndpoint,
        parentId: set.id,
      }),
    )
  }
  return grant
}

export async function switchByTokenExchange(set: TokenSet, org: Organization, scope: string): Promise<GrantResult> {
  const profile = profileOf(set)
  const field = profile.b2b.switchExchange.subjectTokenField
  const subject = switchSubjectToken(profile, set)
  if (!subject) throw new Error(`This token set has no ${field} to exchange.`)
  const grant = await exchangeForOrganization(profile, org, credentialsForSet(set, profile), subject, scope)
  if (grant.tokens) {
    // Carry a long-lived subject (such as a device secret) over to the new set so switching can go on.
    const carried = field !== 'access_token' && field !== 'id_token' && !grant.tokens[field] ? { [field]: subject } : {}
    addTokenSet(
      newTokenSet({
        label: `Switched to ${org.name}`,
        grant: 'token_exchange',
        profileId: set.profileId,
        response: { ...carried, ...grant.tokens },
        organization: org,
        tokenEndpoint: orgTokenEndpoint(profile, org),
        parentId: set.id,
        client: set.client,
      }),
    )
  }
  return grant
}

/** Stores a token set from a grant that has no authorization response (client credentials, device, exchange). */
export function storeGrantTokens(profile: Profile, grant: GrantKind, label: string, response: TokenResponse, tokenEndpoint: string, creds: ClientCredentials, parentId?: string): TokenSet {
  const other = creds.clientId !== profile.clientId
  // Remember another client's secret for this page, so the set can be refreshed or revoked with it.
  if (other && creds.clientSecret) setState((s) => ({ otherClientSecrets: { ...s.otherClientSecrets, [creds.clientId]: creds.clientSecret! } }))
  const client = other ? { clientId: creds.clientId, method: creds.method } : undefined
  const set = newTokenSet({ label, grant, profileId: profile.id, response, tokenEndpoint, parentId, client })
  addTokenSet(set)
  return set
}
