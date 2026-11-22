// OpenID Connect Discovery 1.0 and RFC 8414 metadata.
import { tracedFetch, type HttpExchange } from './http'
import type { Jwks } from './jwt'

export interface ProviderMetadata {
  issuer: string
  authorization_endpoint?: string
  token_endpoint?: string
  userinfo_endpoint?: string
  jwks_uri?: string
  introspection_endpoint?: string
  revocation_endpoint?: string
  end_session_endpoint?: string
  pushed_authorization_request_endpoint?: string
  device_authorization_endpoint?: string
  backchannel_authentication_endpoint?: string
  scopes_supported?: string[]
  response_types_supported?: string[]
  response_modes_supported?: string[]
  grant_types_supported?: string[]
  code_challenge_methods_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
  claims_supported?: string[]
  id_token_signing_alg_values_supported?: string[]
  authorization_response_iss_parameter_supported?: boolean
  dpop_signing_alg_values_supported?: string[]
  [key: string]: unknown
}

export function discoveryUrls(issuerOrUrl: string): string[] {
  const input = issuerOrUrl.trim().replace(/\/+$/, '')
  if (input.includes('/.well-known/')) return [input]
  const url = new URL(input)
  const path = url.pathname === '/' ? '' : url.pathname
  // OIDC appends the well-known suffix to the issuer path; RFC 8414 inserts it before the path.
  const urls = [`${url.origin}${path}/.well-known/openid-configuration`]
  urls.push(`${url.origin}/.well-known/oauth-authorization-server${path}`)
  return [...new Set(urls)]
}

export interface DiscoveryResult {
  metadata?: ProviderMetadata
  exchanges: HttpExchange[]
  error?: string
  warnings: string[]
}

export async function discover(issuerOrUrl: string): Promise<DiscoveryResult> {
  const exchanges: HttpExchange[] = []
  let lastError = 'Discovery failed.'
  for (const url of discoveryUrls(issuerOrUrl)) {
    const ex = await tracedFetch({ label: 'Discovery', url })
    exchanges.push(ex)
    if (ex.networkError) {
      lastError = ex.networkError
      continue
    }
    const body = ex.response?.json as ProviderMetadata | undefined
    if (ex.response && ex.response.status === 200 && body && typeof body.issuer === 'string') {
      const warnings: string[] = []
      const expectedIssuer = issuerOrUrl.includes('/.well-known/') ? undefined : issuerOrUrl.trim().replace(/\/+$/, '')
      if (expectedIssuer && body.issuer.replace(/\/+$/, '') !== expectedIssuer)
        warnings.push(`The metadata issuer (${body.issuer}) differs from the URL you entered (${expectedIssuer}).`)
      if (body.code_challenge_methods_supported && !body.code_challenge_methods_supported.includes('S256'))
        warnings.push('The server does not advertise S256 PKCE.')
      return { metadata: body, exchanges, warnings }
    }
    lastError = `HTTP ${ex.response?.status ?? '?'} from ${url}`
  }
  return { exchanges, error: lastError, warnings: [] }
}

export async function fetchJwks(jwksUri: string): Promise<{ jwks?: Jwks; exchange: HttpExchange; error?: string }> {
  const exchange = await tracedFetch({ label: 'JWKS', url: jwksUri })
  const body = exchange.response?.json as Jwks | undefined
  if (body && Array.isArray(body.keys)) return { jwks: body, exchange }
  return { exchange, error: exchange.networkError ?? `HTTP ${exchange.response?.status ?? '?'}` }
}
