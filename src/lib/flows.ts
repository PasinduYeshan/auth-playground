// Orchestration: ties the protocol core to the app store. Views call these; nothing here renders.
import { buildAuthorizationRequest, checkCallback, parseCallback, prunePending, pushAuthorizationRequest, savePending, takePending, withPushedRequest, type AuthorizationRequest, type BuildOptions, type CallbackCheck, type CallbackParams, type ParResult, type PendingAuthorization, type ReceivedCode } from './oauth/authorize'
import { exchangeForOrganization, orgEndpoints, orgTokenEndpoint, switchSubjectToken } from './oauth/b2b'
import { codeExchangeForm, exchangeCode, refresh, type ClientCredentials, type GrantResult } from './oauth/client'
import { discover, fetchJwks } from './oauth/discovery'
import type { Jwks } from './oauth/jwt'
import type { GrantKind, Organization, Profile, TokenResponse, TokenSet } from './oauth/types'
import { activeProfile, addCode, addTokenSet, getState, removeCode, secretsFor, setState, updateProfile } from './store/appStore'

export function credentialsFor(profile: Profile): ClientCredentials {
  return { clientId: profile.clientId, method: profile.clientAuthMethod, clientSecret: secretsFor(profile.id).clientSecret }
}

export function introspectionCredentialsFor(profile: Profile): ClientCredentials {
  if (!profile.introspectionClientId) return credentialsFor(profile)
  return {
    clientId: profile.introspectionClientId,
    method: profile.introspectionAuthMethod,
    clientSecret: secretsFor(profile.id).introspectionClientSecret,
  }
}

export async function runDiscovery(profile: Profile): Promise<{ error?: string; warnings: string[] }> {
  const result = await discover(profile.issuer)
  if (!result.metadata) return { error: result.error, warnings: [] }
  const m = result.metadata
  setState((s) => ({ metadata: { ...s.metadata, [profile.id]: m } }))
  updateProfile(profile.id, {
    issuer: profile.issuer.includes('/.well-known/') ? m.issuer : profile.issuer.replace(/\/+$/, '') || m.issuer,
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

export async function loadJwks(profileId: string, uri: string): Promise<Jwks | undefined> {
  if (!uri) return undefined
  const { jwks } = await fetchJwks(uri)
  if (jwks) setState((s) => ({ jwks: { ...s.jwks, [profileId]: jwks } }))
  return jwks
}

export async function ensureJwks(profile: Profile): Promise<Jwks | undefined> {
  return getState().jwks[profile.id] ?? loadJwks(profile.id, profile.endpoints.jwks)
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

export function navigateToAuthorization(pending: PendingAuthorization): void {
  prunePending()
  savePending(pending)
  window.location.assign(pending.authorizationUrl)
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
  error?: string
}

export interface RedeemOutcome {
  grant?: GrantResult
  tokenSet?: TokenSet
  error?: string
}

/** Runs once on the /callback page: checks the response and keeps the code. Redeeming is a separate step. */
export function receiveCallback(location: Location): CallbackOutcome {
  const callback = parseCallback(location)
  if (!callback) return { error: 'This page expects an authorization response (code or error) in the URL.' }
  // Drop the code from the address bar and history straight away.
  window.history.replaceState(null, '', location.pathname)
  const pending = callback.state ? takePending(callback.state) : undefined
  const check = checkCallback(callback, pending)
  if (callback.error || !check.ok || !callback.code || !pending) return { callback, pending, check }
  const received: ReceivedCode = { id: pending.state, code: callback.code, receivedAt: Date.now(), pending }
  addCode(received)
  return { callback, pending, check, received }
}

/** Redeems a received code at the token endpoint the request named, and stores the token set. */
export async function redeemCode(received: ReceivedCode): Promise<RedeemOutcome> {
  const { pending, code } = received
  // Use the live profile for credentials (secrets live in memory), the snapshot for request details.
  const profile = getState().profiles.find((p) => p.id === pending.profile.id) ?? pending.profile
  let grant: GrantResult
  try {
    grant = await exchangeCode({
      tokenEndpoint: pending.tokenEndpoint,
      creds: credentialsFor(profile),
      code,
      redirectUri: pending.profile.redirectUri,
      codeVerifier: pending.codeVerifier,
      resources: pending.profile.resources,
      extraParams: pending.profile.extraTokenParams,
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  // The code is single use: a failed redemption has most likely spent it too (RFC 6749 §4.1.2).
  removeCode(received.id)
  if (!grant.tokens) return { grant }
  const tokenSet = newTokenSet({
    label: pending.label ?? (pending.organization ? `Sign in to ${pending.organization.name}` : 'Authorization code'),
    grant: 'authorization_code',
    profileId: pending.profile.id,
    response: grant.tokens,
    nonce: pending.nonce,
    code,
    organization: pending.organization,
    tokenEndpoint: pending.tokenEndpoint,
  })
  addTokenSet(tokenSet)
  setState({ view: 'tokens' })
  return { grant, tokenSet }
}

const shellQuote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`

/** The token request for a received code as curl, to redeem it outside the playground. The client
 * secret is left as $CLIENT_SECRET so it never reaches the clipboard. */
export function codeExchangeCurl(received: ReceivedCode): string {
  const { pending, code } = received
  const profile = getState().profiles.find((p) => p.id === pending.profile.id) ?? pending.profile
  const form = codeExchangeForm({
    code,
    redirectUri: pending.profile.redirectUri,
    codeVerifier: pending.codeVerifier,
    resources: pending.profile.resources,
    extraParams: pending.profile.extraTokenParams,
  })
  const parts = ['curl', '-i', '-X', 'POST', '-H', shellQuote('Content-Type: application/x-www-form-urlencoded')]
  if (profile.clientAuthMethod === 'client_secret_basic') parts.push('-u', `${shellQuote(profile.clientId)}:"$CLIENT_SECRET"`)
  else form.client_id = profile.clientId
  for (const [k, v] of Object.entries(form)) if (v) parts.push('--data-urlencode', shellQuote(`${k}=${v}`))
  if (profile.clientAuthMethod === 'client_secret_post') parts.push('--data-urlencode', '"client_secret=$CLIENT_SECRET"')
  parts.push(shellQuote(pending.tokenEndpoint))
  return parts.join(' ')
}

export async function refreshTokenSet(set: TokenSet, scope?: string): Promise<GrantResult> {
  const profile = getState().profiles.find((p) => p.id === set.profileId) ?? activeProfile()
  if (!set.response.refresh_token) throw new Error('This token set has no refresh token.')
  // By default refresh at the default token endpoint: some servers' organization token endpoints
  // accept no refresh grant, and the refresh token itself records the organization.
  const tokenEndpoint = profile.b2b.refreshAtOrgTokenEndpoint && set.tokenEndpoint ? set.tokenEndpoint : profile.endpoints.token
  const grant = await refresh({
    tokenEndpoint,
    creds: credentialsFor(profile),
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
        // A refresh response may omit the ID token or a new refresh token; keep the scope it returns.
        response: grant.tokens,
        organization: set.organization,
        tokenEndpoint,
        parentId: set.id,
      }),
    )
  }
  return grant
}

export async function switchByTokenExchange(set: TokenSet, org: Organization, scope: string): Promise<GrantResult> {
  const profile = getState().profiles.find((p) => p.id === set.profileId) ?? activeProfile()
  const field = profile.b2b.switchExchange.subjectTokenField
  const subject = switchSubjectToken(profile, set)
  if (!subject) throw new Error(`This token set has no ${field} to exchange.`)
  const grant = await exchangeForOrganization(profile, org, credentialsFor(profile), subject, scope)
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
      }),
    )
  }
  return grant
}

/** Stores a token set from a grant that has no authorization response (client credentials, device, exchange). */
export function storeGrantTokens(profile: Profile, grant: GrantKind, label: string, response: TokenResponse, tokenEndpoint: string, parentId?: string): TokenSet {
  const set = newTokenSet({ label, grant, profileId: profile.id, response, tokenEndpoint, parentId })
  addTokenSet(set)
  return set
}
