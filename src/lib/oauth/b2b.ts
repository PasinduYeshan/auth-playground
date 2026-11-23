// Organization (B2B) support. Servers differ in how a request names an organization: some put it in
// the endpoint path ({issuer}/o/{org}/authorize), others take a request parameter (organization=...).
// Both are configurable, as are the claims that name the organization in a token. Switching is a new
// sign-in to the other organization (silent with prompt=none when the session allows it), or a token
// exchange (RFC 8693) at the organization's token endpoint.
import { customGrant, TOKEN_EXCHANGE_GRANT, type ClientCredentials, type GrantResult } from './client'
import { tracedFetch, type HttpExchange } from './http'
import { decodeToken } from './jwt'
import { isHttpUrl } from './url'
import { genericB2B, type B2BConfig, type OrgClaims, type Organization, type Profile, type TokenSet } from './types'

export function resolveTemplate(template: string, issuer: string, org: string): string {
  return template.replace(/\{issuer\}/g, issuer.replace(/\/+$/, '')).replace(/\{org\}/g, encodeURIComponent(org))
}

/** The value for {issuer}: the configured issuer, else the origin of the authorization endpoint
 * (where most servers, ThunderID among them, also serve the organization endpoints). */
export function templateIssuer(profile: Profile): string {
  if (profile.issuer.trim()) return profile.issuer.trim()
  for (const ep of [profile.endpoints.authorization, profile.endpoints.token]) {
    if (isHttpUrl(ep)) return new URL(ep).origin
  }
  throw new Error('Set the server base URL (the issuer) on the Sign in page: the organization endpoints are built from it.')
}

export interface OrgEndpoints {
  authorization: string
  token: string
  /** Extra authorization parameters (style 'param'). */
  params: [string, string][]
}

export function orgEndpoints(profile: Profile, org: Organization): OrgEndpoints {
  const b2b = profile.b2b
  if (b2b.style === 'param') {
    return { authorization: profile.endpoints.authorization, token: profile.endpoints.token, params: [[b2b.paramName, org.id]] }
  }
  const issuer = templateIssuer(profile)
  return {
    authorization: resolveTemplate(b2b.authorizeTemplate, issuer, org.id),
    token: b2b.redeemAtOrgTokenEndpoint ? resolveTemplate(b2b.tokenTemplate, issuer, org.id) : profile.endpoints.token,
    params: [],
  }
}

export interface OrgListResult {
  exchange: HttpExchange
  organizations?: Organization[]
  current?: string
  error?: string
}

/** Reads the user's organizations: a plain array, or an object with organizationUnits, organizations or items. */
export async function fetchOrganizations(profile: Profile, accessToken: string): Promise<OrgListResult> {
  if (!profile.b2b.listTemplate.trim()) throw new Error('Set the organization list endpoint first.')
  const url = resolveTemplate(profile.b2b.listTemplate, templateIssuer(profile), '')
  const exchange = await tracedFetch({ label: 'List organizations', url, headers: { Authorization: `Bearer ${accessToken}` } })
  const body = exchange.response?.json as Record<string, unknown> | unknown[] | undefined
  if (!exchange.response || exchange.response.status >= 300 || !body)
    return { exchange, error: exchange.networkError ?? `HTTP ${exchange.response?.status ?? '?'}` }
  const list = Array.isArray(body)
    ? body
    : ((body.organizationUnits ?? body.organizations ?? body.items ?? []) as unknown[])
  const organizations = list
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && typeof (o as Record<string, unknown>).id === 'string')
    .map((o) => ({ id: String(o.id), name: String(o.name ?? o.displayName ?? o.handle ?? o.id), handle: o.handle ? String(o.handle) : undefined }))
  return { exchange, organizations, current: Array.isArray(body) ? undefined : (body.current as string | undefined) }
}

export { TOKEN_EXCHANGE_GRANT }

/** The subject token a switch would use, taken from the configured token response field. */
export function switchSubjectToken(profile: Profile, set: TokenSet): string | undefined {
  const value = set.response[profile.b2b.switchExchange.subjectTokenField]
  return typeof value === 'string' && value ? value : undefined
}

/** Switches organization by token exchange at the organization's token endpoint. */
export function exchangeForOrganization(
  profile: Profile,
  org: Organization,
  creds: ClientCredentials,
  subjectToken: string,
  scope: string,
): Promise<GrantResult> {
  const endpoint = orgTokenEndpoint(profile, org)
  const form: Record<string, string | undefined> = {
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: subjectToken,
    subject_token_type: profile.b2b.switchExchange.subjectTokenType,
    scope: scope || undefined,
  }
  if (profile.b2b.style === 'param') form[profile.b2b.paramName] = org.id
  return customGrant(`Token exchange → ${org.name}`, endpoint, creds, form)
}

/** The organization's token endpoint (the default one for parameter-style servers). */
export function orgTokenEndpoint(profile: Profile, org: Organization): string {
  if (profile.b2b.style === 'param') return profile.endpoints.token
  return resolveTemplate(profile.b2b.tokenTemplate, templateIssuer(profile), org.id)
}

const COMMON_ORG_CLAIMS: OrgClaims[] = [
  { id: 'org_id', name: 'org_name', handle: '' },
  { id: 'organization_id', name: 'organization_name', handle: '' },
  { id: 'ouId', name: 'ouName', handle: 'ouHandle' },
]

/** The organization a token set was issued for: the configured claims first, then common names. */
export function organizationOf(set: TokenSet, claims?: OrgClaims): Organization | undefined {
  const candidates = claims ? [claims, ...COMMON_ORG_CLAIMS] : COMMON_ORG_CLAIMS
  for (const raw of [set.response.access_token, set.response.id_token]) {
    if (!raw) continue
    const t = decodeToken(raw)
    if (t.kind !== 'jwt') continue
    const p = t.payload
    for (const c of candidates) {
      const id = c.id ? p[c.id] : undefined
      if (typeof id !== 'string' || !id) continue
      const name = c.name && typeof p[c.name] === 'string' ? String(p[c.name]) : id
      const handle = c.handle && typeof p[c.handle] === 'string' ? String(p[c.handle]) : undefined
      return { id, name, handle }
    }
  }
  return set.organization
}

export type DiffStatus = 'same' | 'changed' | 'added' | 'removed'

export interface ClaimDiffRow {
  claim: string
  left: unknown
  right: unknown
  status: DiffStatus
}

const VOLATILE = new Set(['exp', 'iat', 'nbf', 'jti', 'auth_time', 'at_hash', 'c_hash', 'nonce', 'tfid', 'aci', 'sid'])

export function isVolatileClaim(claim: string): boolean {
  return VOLATILE.has(claim)
}

export function diffClaims(left: Record<string, unknown>, right: Record<string, unknown>): ClaimDiffRow[] {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  return keys.map((claim) => {
    const inL = claim in left
    const inR = claim in right
    let status: DiffStatus = 'same'
    if (!inL) status = 'added'
    else if (!inR) status = 'removed'
    else if (JSON.stringify(left[claim]) !== JSON.stringify(right[claim])) status = 'changed'
    return { claim, left: left[claim], right: right[claim], status }
  })
}

export function sanitizeB2B(input: unknown, base: B2BConfig = genericB2B()): B2BConfig {
  const src = (input && typeof input === 'object' ? input : {}) as Partial<B2BConfig>
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const claims = (src.orgClaims ?? {}) as Partial<OrgClaims>
  const sw = (src.switchExchange ?? {}) as Partial<B2BConfig['switchExchange']>
  return {
    style: src.style === 'path' || src.style === 'param' ? src.style : base.style,
    authorizeTemplate: str(src.authorizeTemplate, base.authorizeTemplate),
    tokenTemplate: str(src.tokenTemplate, base.tokenTemplate),
    paramName: str(src.paramName, base.paramName),
    listTemplate: str(src.listTemplate, base.listTemplate),
    redeemAtOrgTokenEndpoint: bool(src.redeemAtOrgTokenEndpoint, base.redeemAtOrgTokenEndpoint),
    refreshAtOrgTokenEndpoint: bool(src.refreshAtOrgTokenEndpoint, base.refreshAtOrgTokenEndpoint),
    orgClaims: { id: str(claims.id, base.orgClaims.id), name: str(claims.name, base.orgClaims.name), handle: str(claims.handle, base.orgClaims.handle) },
    switchExchange: {
      subjectTokenField: str(sw.subjectTokenField, base.switchExchange.subjectTokenField),
      subjectTokenType: str(sw.subjectTokenType, base.switchExchange.subjectTokenType),
    },
    organizations: Array.isArray(src.organizations)
      ? src.organizations
          .filter((o) => o && typeof o.id === 'string')
          .map((o) => ({ id: o.id, name: String(o.name ?? o.id), handle: o.handle ? String(o.handle) : undefined }))
      : [],
  }
}
