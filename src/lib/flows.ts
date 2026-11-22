// Orchestration: ties the protocol core to the app store. Views call these; nothing here renders.
import { buildAuthorizationRequest, checkCallback, parseCallback, prunePending, savePending, takePending, type BuildOptions, type CallbackCheck, type CallbackParams, type PendingAuthorization } from './oauth/authorize'
import { exchangeDeviceSecret, orgEndpoints } from './oauth/b2b'
import { exchangeCode, refresh, type ClientCredentials, type GrantResult } from './oauth/client'
import { discover, fetchJwks } from './oauth/discovery'
import type { Jwks } from './oauth/jwt'
import type { Organization, Profile, TokenSet } from './oauth/types'
import { activeProfile, addTokenSet, getState, secretsFor, setState, updateProfile } from './store/appStore'

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

export interface CallbackOutcome {
  callback?: CallbackParams
  pending?: PendingAuthorization
  check?: CallbackCheck
  grant?: GrantResult
  tokenSet?: TokenSet
  error?: string
}

/** Runs once on the /callback page: checks the response, redeems the code, stores the token set. */
export async function completeCallback(location: Location): Promise<CallbackOutcome> {
  const callback = parseCallback(location)
  if (!callback) return { error: 'This page expects an authorization response (code or error) in the URL.' }
  // Drop the code from the address bar and history straight away.
  window.history.replaceState(null, '', location.pathname)
  const pending = callback.state ? takePending(callback.state) : undefined
  const check = checkCallback(callback, pending)
  if (callback.error || !check.ok || !callback.code || !pending) return { callback, pending, check }

  // Use the live profile for credentials (secrets live in memory), the snapshot for request details.
  const profile = getState().profiles.find((p) => p.id === pending.profile.id) ?? pending.profile
  let grant: GrantResult
  try {
    grant = await exchangeCode({
      tokenEndpoint: pending.tokenEndpoint,
      creds: credentialsFor(profile),
      code: callback.code,
      redirectUri: pending.profile.redirectUri,
      codeVerifier: pending.codeVerifier,
      resources: pending.profile.resources,
      extraParams: pending.profile.extraTokenParams,
    })
  } catch (err) {
    return { callback, pending, check, error: err instanceof Error ? err.message : String(err) }
  }
  if (!grant.tokens) return { callback, pending, check, grant }
  const tokenSet = newTokenSet({
    label: pending.label ?? (pending.organization ? `Sign in to ${pending.organization.name}` : 'Authorization code'),
    grant: 'authorization_code',
    profileId: pending.profile.id,
    response: grant.tokens,
    nonce: pending.nonce,
    code: callback.code,
    organization: pending.organization,
    tokenEndpoint: pending.tokenEndpoint,
  })
  addTokenSet(tokenSet)
  setState({ view: 'tokens' })
  return { callback, pending, check, grant, tokenSet }
}

export async function refreshTokenSet(set: TokenSet, scope?: string): Promise<GrantResult> {
  const profile = getState().profiles.find((p) => p.id === set.profileId) ?? activeProfile()
  if (!set.response.refresh_token) throw new Error('This token set has no refresh token.')
  // Refresh at the default token endpoint: ThunderID's organization token endpoint accepts only the
  // authorization code, client credentials and token exchange grants. The refresh token itself records
  // the organization, so the new tokens stay in it.
  const grant = await refresh({
    tokenEndpoint: profile.endpoints.token,
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
        tokenEndpoint: profile.endpoints.token,
        parentId: set.id,
      }),
    )
  }
  return grant
}

export async function switchWithDeviceSecret(set: TokenSet, org: Organization, scope: string): Promise<GrantResult> {
  const profile = getState().profiles.find((p) => p.id === set.profileId) ?? activeProfile()
  const deviceSecret = set.response.device_secret
  if (typeof deviceSecret !== 'string') throw new Error('This token set has no device_secret. Sign in with the device_sso scope.')
  const grant = await exchangeDeviceSecret(profile, org, credentialsFor(profile), deviceSecret, scope)
  if (grant.tokens) {
    addTokenSet(
      newTokenSet({
        label: `Switched to ${org.name}`,
        grant: 'device_secret_exchange',
        profileId: set.profileId,
        // Keep the device secret on the new set so the user can keep switching.
        response: { device_secret: deviceSecret, ...grant.tokens },
        organization: org,
        tokenEndpoint: orgEndpoints(profile, org).token,
        parentId: set.id,
      }),
    )
  }
  return grant
}
