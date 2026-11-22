// Token endpoint grants and token operations: UserInfo (OIDC Core §5.3), introspection (RFC 7662)
// and revocation (RFC 7009). Every call goes through tracedFetch so the UI shows it.
import { tracedFetch, type HttpExchange } from './http'
import type { ClientAuthMethod, KeyValue, TokenResponse } from './types'

export interface ClientCredentials {
  clientId: string
  method: ClientAuthMethod
  clientSecret?: string
}

/** RFC 6749 §2.3.1: Basic credentials are form-urlencoded before base64. */
export function basicAuthHeader(clientId: string, secret: string): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+')
  return `Basic ${btoa(`${enc(clientId)}:${enc(secret)}`)}`
}

export function applyClientAuth(
  creds: ClientCredentials,
  form: Record<string, string | undefined>,
  headers: Record<string, string>,
): void {
  if (creds.method === 'client_secret_basic') {
    if (!creds.clientSecret) throw new Error('This client authenticates with client_secret_basic; enter the client secret.')
    headers.Authorization = basicAuthHeader(creds.clientId, creds.clientSecret)
    return
  }
  form.client_id = creds.clientId
  if (creds.method === 'client_secret_post') {
    if (!creds.clientSecret) throw new Error('This client authenticates with client_secret_post; enter the client secret.')
    form.client_secret = creds.clientSecret
  }
}

function extras(list: KeyValue[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of list ?? []) if (p.enabled && p.key.trim()) out[p.key.trim()] = p.value
  return out
}

export interface GrantResult {
  exchange: HttpExchange
  tokens?: TokenResponse
  error?: { error: string; error_description?: string }
}

function toGrantResult(exchange: HttpExchange): GrantResult {
  const body = exchange.response?.json as Record<string, unknown> | undefined
  if (exchange.response && exchange.response.status >= 200 && exchange.response.status < 300 && body?.access_token)
    return { exchange, tokens: body as TokenResponse }
  if (body && typeof body.error === 'string')
    return { exchange, error: { error: body.error, error_description: body.error_description as string | undefined } }
  return {
    exchange,
    error: {
      error: exchange.networkError ? 'network_error' : 'unexpected_response',
      error_description: exchange.networkError ?? `HTTP ${exchange.response?.status}`,
    },
  }
}

async function tokenRequest(
  label: string,
  tokenEndpoint: string,
  creds: ClientCredentials,
  form: Record<string, string | undefined>,
): Promise<GrantResult> {
  if (!tokenEndpoint) throw new Error('Set the token endpoint first.')
  const headers: Record<string, string> = {}
  applyClientAuth(creds, form, headers)
  return toGrantResult(await tracedFetch({ label, url: tokenEndpoint, form, headers }))
}

export interface CodeExchangeInput {
  tokenEndpoint: string
  creds: ClientCredentials
  code: string
  redirectUri: string
  codeVerifier: string
  resources?: string[]
  extraParams?: KeyValue[]
}

/** The authorization_code token request without client authentication. */
export function codeExchangeForm(input: Omit<CodeExchangeInput, 'tokenEndpoint' | 'creds'>): Record<string, string | undefined> {
  const form: Record<string, string | undefined> = {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    ...extras(input.extraParams),
  }
  // URLSearchParams supports repeated keys; a record does not, so only the first resource is sent
  // on the token request. Multiple resources are sent on the authorization request.
  if (input.resources?.[0]) form.resource = input.resources[0]
  return form
}

export function exchangeCode(input: CodeExchangeInput): Promise<GrantResult> {
  return tokenRequest('Token: authorization_code', input.tokenEndpoint, input.creds, codeExchangeForm(input))
}

export interface RefreshInput {
  tokenEndpoint: string
  creds: ClientCredentials
  refreshToken: string
  scope?: string
  resource?: string
  extraParams?: KeyValue[]
}

export function refresh(input: RefreshInput): Promise<GrantResult> {
  return tokenRequest('Token: refresh_token', input.tokenEndpoint, input.creds, {
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    scope: input.scope,
    resource: input.resource,
    ...extras(input.extraParams),
  })
}

/** A generic grant for vendor-specific or future grants (organization switch, token exchange). */
export function customGrant(
  label: string,
  tokenEndpoint: string,
  creds: ClientCredentials,
  form: Record<string, string | undefined>,
): Promise<GrantResult> {
  return tokenRequest(label, tokenEndpoint, creds, form)
}

export interface OperationResult {
  exchange: HttpExchange
  ok: boolean
  body?: unknown
}

const okOf = (ex: HttpExchange) => !!ex.response && ex.response.status >= 200 && ex.response.status < 300

export async function callUserInfo(endpoint: string, accessToken: string, method: 'GET' | 'POST' = 'GET'): Promise<OperationResult> {
  if (!endpoint) throw new Error('Set the UserInfo endpoint first.')
  const exchange =
    method === 'GET'
      ? await tracedFetch({ label: 'UserInfo', url: endpoint, headers: { Authorization: `Bearer ${accessToken}` } })
      : await tracedFetch({ label: 'UserInfo (POST)', url: endpoint, method: 'POST', form: {}, headers: { Authorization: `Bearer ${accessToken}` } })
  return { exchange, ok: okOf(exchange), body: exchange.response?.json ?? exchange.response?.body }
}

export type TokenTypeHint = 'access_token' | 'refresh_token' | ''

export async function introspect(
  endpoint: string,
  creds: ClientCredentials,
  token: string,
  hint: TokenTypeHint,
): Promise<OperationResult> {
  if (!endpoint) throw new Error('Set the introspection endpoint first.')
  const form: Record<string, string | undefined> = { token, token_type_hint: hint || undefined }
  const headers: Record<string, string> = {}
  applyClientAuth(creds, form, headers)
  const exchange = await tracedFetch({ label: 'Introspection', url: endpoint, form, headers })
  return { exchange, ok: okOf(exchange), body: exchange.response?.json ?? exchange.response?.body }
}

export async function revoke(endpoint: string, creds: ClientCredentials, token: string, hint: TokenTypeHint): Promise<OperationResult> {
  if (!endpoint) throw new Error('Set the revocation endpoint first.')
  const form: Record<string, string | undefined> = { token, token_type_hint: hint || undefined }
  const headers: Record<string, string> = {}
  applyClientAuth(creds, form, headers)
  const exchange = await tracedFetch({ label: 'Revocation', url: endpoint, form, headers })
  return { exchange, ok: okOf(exchange), body: exchange.response?.json ?? exchange.response?.body }
}

export function buildEndSessionUrl(endpoint: string, params: { idTokenHint?: string; clientId: string; postLogoutRedirectUri?: string; state?: string }): string {
  const url = new URL(endpoint)
  if (params.idTokenHint) url.searchParams.set('id_token_hint', params.idTokenHint)
  url.searchParams.set('client_id', params.clientId)
  if (params.postLogoutRedirectUri) url.searchParams.set('post_logout_redirect_uri', params.postLogoutRedirectUri)
  if (params.state) url.searchParams.set('state', params.state)
  return url.toString()
}

// ---- Client credentials (RFC 6749 §4.4) ----

export interface ClientCredentialsInput {
  tokenEndpoint: string
  creds: ClientCredentials
  scope?: string
  resource?: string
  audience?: string
  extraParams?: KeyValue[]
}

export async function clientCredentialsGrant(input: ClientCredentialsInput): Promise<GrantResult> {
  if (input.creds.method === 'none') throw new Error('Client credentials needs a confidential client: choose client_secret_post or client_secret_basic and enter the secret.')
  return tokenRequest('Token: client_credentials', input.tokenEndpoint, input.creds, {
    grant_type: 'client_credentials',
    scope: input.scope || undefined,
    resource: input.resource || undefined,
    audience: input.audience || undefined,
    ...extras(input.extraParams),
  })
}

// ---- Token exchange (RFC 8693) ----

export const TOKEN_TYPES = {
  access_token: 'urn:ietf:params:oauth:token-type:access_token',
  refresh_token: 'urn:ietf:params:oauth:token-type:refresh_token',
  id_token: 'urn:ietf:params:oauth:token-type:id_token',
  jwt: 'urn:ietf:params:oauth:token-type:jwt',
  saml2: 'urn:ietf:params:oauth:token-type:saml2',
  id_jag: 'urn:ietf:params:oauth:token-type:id-jag',
} as const

export const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'

export interface TokenExchangeInput {
  tokenEndpoint: string
  creds: ClientCredentials
  subjectToken: string
  subjectTokenType: string
  actorToken?: string
  actorTokenType?: string
  requestedTokenType?: string
  audience?: string
  resource?: string
  scope?: string
  extraParams?: KeyValue[]
}

/** Builds the RFC 8693 form; empty optional fields are left out. Exported for tests. */
export function tokenExchangeForm(input: Omit<TokenExchangeInput, 'tokenEndpoint' | 'creds'>): Record<string, string | undefined> {
  if (!input.subjectToken.trim()) throw new Error('Enter or pick a subject token.')
  if (!input.subjectTokenType.trim()) throw new Error('Choose the subject token type.')
  const actor = input.actorToken?.trim()
  if (actor && !input.actorTokenType?.trim()) throw new Error('Choose the actor token type.')
  return {
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: input.subjectToken.trim(),
    subject_token_type: input.subjectTokenType.trim(),
    actor_token: actor || undefined,
    actor_token_type: actor ? input.actorTokenType?.trim() : undefined,
    requested_token_type: input.requestedTokenType?.trim() || undefined,
    audience: input.audience?.trim() || undefined,
    resource: input.resource?.trim() || undefined,
    scope: input.scope?.trim() || undefined,
    ...extras(input.extraParams),
  }
}

export function tokenExchangeGrant(input: TokenExchangeInput): Promise<GrantResult> {
  const { tokenEndpoint, creds, ...rest } = input
  return tokenRequest('Token: token_exchange', tokenEndpoint, creds, tokenExchangeForm(rest))
}

// ---- Device authorization (RFC 8628) ----

export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

export interface DeviceAuthorization {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval?: number
  [key: string]: unknown
}

export interface DeviceAuthorizationResult {
  exchange: HttpExchange
  authorization?: DeviceAuthorization
  error?: { error: string; error_description?: string }
}

export async function requestDeviceAuthorization(input: {
  endpoint: string
  creds: ClientCredentials
  scope?: string
  resource?: string
  extraParams?: KeyValue[]
}): Promise<DeviceAuthorizationResult> {
  if (!input.endpoint) throw new Error('Set the device authorization endpoint first (discovery fills it when the server supports the grant).')
  const form: Record<string, string | undefined> = { scope: input.scope || undefined, resource: input.resource || undefined, ...extras(input.extraParams) }
  const headers: Record<string, string> = {}
  applyClientAuth(input.creds, form, headers)
  const exchange = await tracedFetch({ label: 'Device authorization', url: input.endpoint, form, headers })
  const body = exchange.response?.json as Record<string, unknown> | undefined
  if (exchange.response && exchange.response.status < 300 && typeof body?.device_code === 'string' && typeof body.user_code === 'string')
    return { exchange, authorization: body as DeviceAuthorization }
  if (body && typeof body.error === 'string')
    return { exchange, error: { error: body.error, error_description: body.error_description as string | undefined } }
  return {
    exchange,
    error: {
      error: exchange.networkError ? 'network_error' : 'unexpected_response',
      error_description: exchange.networkError ?? `HTTP ${exchange.response?.status}`,
    },
  }
}

export function pollDeviceToken(tokenEndpoint: string, creds: ClientCredentials, deviceCode: string, extraParams?: KeyValue[]): Promise<GrantResult> {
  return tokenRequest('Token: device_code', tokenEndpoint, creds, { grant_type: DEVICE_CODE_GRANT, device_code: deviceCode, ...extras(extraParams) })
}

/** What a poll response means for the polling loop (RFC 8628 §3.5). */
export type PollStep = { kind: 'done' } | { kind: 'wait'; interval: number } | { kind: 'stop'; reason: string }

export function nextPollStep(result: GrantResult, interval: number): PollStep {
  if (result.tokens) return { kind: 'done' }
  switch (result.error?.error) {
    case 'authorization_pending':
      return { kind: 'wait', interval }
    case 'slow_down':
      return { kind: 'wait', interval: interval + 5 }
    case 'access_denied':
      return { kind: 'stop', reason: 'The user denied the request.' }
    case 'expired_token':
      return { kind: 'stop', reason: 'The device code expired before the user approved it.' }
    default:
      return { kind: 'stop', reason: result.error?.error_description || result.error?.error || 'Unexpected response.' }
  }
}
