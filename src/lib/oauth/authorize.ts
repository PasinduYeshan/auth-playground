// Authorization request (RFC 6749 §4.1, RFC 7636, RFC 8707, OIDC Core) and the callback.
import { applyClientAuth, type ClientCredentials } from './client'
import { randomString } from './encoding'
import { tracedFetch, type HttpExchange } from './http'
import { computeCodeChallenge, generateCodeVerifier } from './pkce'
import type { Organization, Profile } from './types'

/** Everything the callback needs, stored in sessionStorage under the state value. */
export interface PendingAuthorization {
  state: string
  nonce?: string
  codeVerifier: string
  codeChallenge: string
  profile: Profile
  /** Organization for B2B runs, carried into the resulting token set. */
  organization?: Organization
  /** Endpoint the request went to (differs from the profile's for organization sign-ins). */
  authorizationEndpoint: string
  /** Token endpoint to redeem the code at. */
  tokenEndpoint: string
  label?: string
  createdAt: number
  /** Where the browser goes: the full request, or client_id and request_uri after a push. */
  authorizationUrl: string
  /** Set once the request was pushed (RFC 9126). */
  par?: { requestUri: string; pushedAt: number; expiresAt: number }
}

export interface AuthorizationRequest {
  url: string
  params: [string, string][]
  pending: PendingAuthorization
}

export interface BuildOptions {
  /** Extra parameters for this run only (for example an organization hint for B2B). */
  overrides?: [string, string][]
  organization?: Organization
  /** Send the request here instead of the profile's authorization endpoint. */
  authorizationEndpoint?: string
  tokenEndpoint?: string
  label?: string
  /** Fixed values for tests and for re-using a previewed request. */
  state?: string
  nonce?: string
  codeVerifier?: string
}

export async function buildAuthorizationRequest(profile: Profile, opts: BuildOptions = {}): Promise<AuthorizationRequest> {
  const endpoint = opts.authorizationEndpoint ?? profile.endpoints.authorization
  if (!endpoint) throw new Error('Set the authorization endpoint first.')
  if (!profile.clientId) throw new Error('Set the client ID first.')
  const state = opts.state ?? randomString(24)
  const nonce = profile.useNonce ? (opts.nonce ?? randomString(24)) : undefined
  const codeVerifier = opts.codeVerifier ?? generateCodeVerifier()
  const codeChallenge = await computeCodeChallenge(codeVerifier, profile.pkceMethod)

  const params: [string, string][] = [
    ['response_type', 'code'],
    ['client_id', profile.clientId],
    ['redirect_uri', profile.redirectUri],
  ]
  if (profile.scope.trim()) params.push(['scope', profile.scope.trim().replace(/\s+/g, ' ')])
  params.push(['state', state])
  if (nonce) params.push(['nonce', nonce])
  params.push(['code_challenge', codeChallenge], ['code_challenge_method', profile.pkceMethod])
  for (const r of profile.resources) if (r.trim()) params.push(['resource', r.trim()])
  const optional: [string, string][] = [
    ['response_mode', profile.responseMode],
    ['prompt', profile.prompt],
    ['login_hint', profile.loginHint],
    ['max_age', profile.maxAge],
    ['acr_values', profile.acrValues],
    ['ui_locales', profile.uiLocales],
  ]
  for (const [k, v] of optional) if (v && v.trim()) params.push([k, v.trim()])
  for (const p of profile.extraAuthParams) if (p.enabled && p.key.trim()) params.push([p.key.trim(), p.value])
  for (const [k, v] of opts.overrides ?? []) {
    const i = params.findIndex(([pk]) => pk === k)
    if (i >= 0) params.splice(i, 1)
    if (v !== '') params.push([k, v])
  }

  const url = new URL(endpoint)
  for (const [k, v] of params) url.searchParams.append(k, v)
  const pending: PendingAuthorization = {
    state,
    nonce,
    codeVerifier,
    codeChallenge,
    profile,
    organization: opts.organization,
    authorizationEndpoint: endpoint,
    tokenEndpoint: opts.tokenEndpoint ?? profile.endpoints.token,
    label: opts.label,
    createdAt: Date.now(),
    authorizationUrl: url.toString(),
  }
  return { url: url.toString(), params, pending }
}

// Pushed authorization requests (RFC 9126): the parameters go to the server in a back-channel POST,
// and the front channel carries only client_id and the request_uri the server returns.

/** The PAR form: every authorization parameter plus client authentication, as on the token endpoint. */
export function parForm(params: [string, string][], creds: ClientCredentials): { form: [string, string][]; headers: Record<string, string> } {
  const auth: Record<string, string | undefined> = {}
  const headers: Record<string, string> = {}
  applyClientAuth(creds, auth, headers)
  const form = params.filter(([k]) => k !== 'request_uri')
  for (const [k, v] of Object.entries(auth)) {
    if (v === undefined || form.some(([fk]) => fk === k)) continue
    form.push([k, v])
  }
  return { form, headers }
}

export interface ParResult {
  exchange: HttpExchange
  requestUri?: string
  expiresIn?: number
  error?: { error: string; error_description?: string }
}

export async function pushAuthorizationRequest(endpoint: string, params: [string, string][], creds: ClientCredentials): Promise<ParResult> {
  if (!endpoint) throw new Error('Set the pushed authorization request endpoint first (run discovery).')
  const { form, headers } = parForm(params, creds)
  const exchange = await tracedFetch({ label: 'Pushed authorization request', url: endpoint, form, headers })
  const body = exchange.response?.json as Record<string, unknown> | undefined
  const status = exchange.response?.status ?? 0
  if (status >= 200 && status < 300 && typeof body?.request_uri === 'string')
    return { exchange, requestUri: body.request_uri, expiresIn: typeof body.expires_in === 'number' ? body.expires_in : undefined }
  if (body && typeof body.error === 'string')
    return { exchange, error: { error: body.error, error_description: body.error_description as string | undefined } }
  return {
    exchange,
    error: {
      error: exchange.networkError ? 'network_error' : 'unexpected_response',
      error_description: exchange.networkError ?? `HTTP ${status}`,
    },
  }
}

/** RFC 9126 §4: the authorization request after a push carries client_id and request_uri only. */
export function parAuthorizationUrl(authorizationEndpoint: string, clientId: string, requestUri: string): string {
  const url = new URL(authorizationEndpoint)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('request_uri', requestUri)
  return url.toString()
}

/** The pending transaction after a successful push: same state and verifier, shorter URL. */
export function withPushedRequest(pending: PendingAuthorization, requestUri: string, expiresIn: number | undefined, now = Date.now()): PendingAuthorization {
  return {
    ...pending,
    authorizationUrl: parAuthorizationUrl(pending.authorizationEndpoint, pending.profile.clientId, requestUri),
    // RFC 9126 requires expires_in; assume a minute if a server leaves it out.
    par: { requestUri, pushedAt: now, expiresAt: now + (expiresIn ?? 60) * 1000 },
  }
}

const PENDING_PREFIX = 'ap:pending:'
const PENDING_TTL_MS = 30 * 60 * 1000

export function savePending(p: PendingAuthorization): void {
  sessionStorage.setItem(PENDING_PREFIX + p.state, JSON.stringify(p))
}

/** Reads and removes the transaction: a state value is good for one callback only. */
export function takePending(state: string): PendingAuthorization | undefined {
  const key = PENDING_PREFIX + state
  const raw = sessionStorage.getItem(key)
  sessionStorage.removeItem(key)
  if (!raw) return undefined
  const p = JSON.parse(raw) as PendingAuthorization
  if (Date.now() - p.createdAt > PENDING_TTL_MS) return undefined
  return p
}

export function prunePending(): void {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i)
    if (!key?.startsWith(PENDING_PREFIX)) continue
    try {
      const p = JSON.parse(sessionStorage.getItem(key) ?? '{}') as PendingAuthorization
      if (!p.createdAt || Date.now() - p.createdAt > PENDING_TTL_MS) sessionStorage.removeItem(key)
    } catch {
      sessionStorage.removeItem(key)
    }
  }
}

export interface CallbackParams {
  raw: Record<string, string>
  source: 'query' | 'fragment'
  code?: string
  state?: string
  iss?: string
  error?: string
  errorDescription?: string
  errorUri?: string
}

export function parseCallback(location: { search: string; hash: string }): CallbackParams | undefined {
  const fromQuery = new URLSearchParams(location.search)
  const fromFragment = new URLSearchParams(location.hash.replace(/^#/, ''))
  const pick = fromQuery.has('state') || fromQuery.has('code') || fromQuery.has('error') ? 'query' : 'fragment'
  const params = pick === 'query' ? fromQuery : fromFragment
  if (!params.has('code') && !params.has('error') && !params.has('state')) return undefined
  const raw: Record<string, string> = {}
  params.forEach((v, k) => {
    raw[k] = v
  })
  return {
    raw,
    source: pick,
    code: params.get('code') ?? undefined,
    state: params.get('state') ?? undefined,
    iss: params.get('iss') ?? undefined,
    error: params.get('error') ?? undefined,
    errorDescription: params.get('error_description') ?? undefined,
    errorUri: params.get('error_uri') ?? undefined,
  }
}

/** A code that passed the callback checks and waits for the user to redeem it (or not). */
export interface ReceivedCode {
  id: string
  code: string
  receivedAt: number
  pending: PendingAuthorization
}

export interface CallbackCheck {
  ok: boolean
  problems: string[]
}

/** State binding (RFC 6749 §10.12) and the issuer identifier (RFC 9207) when the server sends one. */
export function checkCallback(cb: CallbackParams, pending: PendingAuthorization | undefined): CallbackCheck {
  const problems: string[] = []
  if (!cb.state) problems.push('The response has no state parameter.')
  else if (!pending) problems.push('No pending request matches this state (expired, already used, or started in another tab).')
  if (pending && cb.iss && pending.profile.issuer && cb.iss.replace(/\/+$/, '') !== pending.profile.issuer.replace(/\/+$/, ''))
    problems.push(`The iss parameter (${cb.iss}) does not match the configured issuer (${pending.profile.issuer}).`)
  return { ok: problems.length === 0, problems }
}
