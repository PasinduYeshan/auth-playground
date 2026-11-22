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

export function exchangeCode(input: CodeExchangeInput): Promise<GrantResult> {
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
  return tokenRequest('Token: authorization_code', input.tokenEndpoint, input.creds, form)
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
