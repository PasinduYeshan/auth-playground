// Organization (B2B) support. Servers differ in how a request names an organization, so endpoints come
// from templates. ThunderID selects an organization unit by path: /ou/{ouId}/oauth2/authorize and
// /ou/{ouId}/oauth2/token. Switching is a new sign-in to the other organization (silent with
// prompt=none when the SSO session allows it), or a device-secret token exchange at its token endpoint.
import { customGrant, type ClientCredentials, type GrantResult } from './client'
import { tracedFetch, type HttpExchange } from './http'
import { decodeToken } from './jwt'
import type { B2BConfig, Organization, Profile, TokenSet } from './types'

export function resolveTemplate(template: string, issuer: string, org: string): string {
  return template.replace(/\{issuer\}/g, issuer.replace(/\/+$/, '')).replace(/\{org\}/g, encodeURIComponent(org))
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
  if (!profile.issuer) throw new Error('Set the issuer: the organization endpoint templates use it.')
  return {
    authorization: resolveTemplate(b2b.authorizeTemplate, profile.issuer, org.id),
    token: b2b.redeemAtOrgTokenEndpoint ? resolveTemplate(b2b.tokenTemplate, profile.issuer, org.id) : profile.endpoints.token,
    params: [],
  }
}

export interface OrgListResult {
  exchange: HttpExchange
  organizations?: Organization[]
  current?: string
  error?: string
}

/** Reads the user's organizations. Understands ThunderID's {organizationUnits, current} and plain arrays. */
export async function fetchOrganizations(profile: Profile, accessToken: string): Promise<OrgListResult> {
  const url = resolveTemplate(profile.b2b.listTemplate, profile.issuer, '')
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

export const DEVICE_SECRET_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:jwt'
export const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'

/** ThunderID device-secret switch: exchange the device secret at the organization's token endpoint. */
export function exchangeDeviceSecret(
  profile: Profile,
  org: Organization,
  creds: ClientCredentials,
  deviceSecret: string,
  scope: string,
): Promise<GrantResult> {
  const endpoint = resolveTemplate(profile.b2b.tokenTemplate, profile.issuer, org.id)
  return customGrant(`Token: device secret → ${org.name}`, endpoint, creds, {
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: deviceSecret,
    subject_token_type: DEVICE_SECRET_TOKEN_TYPE,
    scope,
  })
}

/** The organization a token set was issued for, from its claims (ThunderID: ouId, ouName, ouHandle). */
export function organizationOf(set: TokenSet): Organization | undefined {
  for (const raw of [set.response.access_token, set.response.id_token]) {
    if (!raw) continue
    const t = decodeToken(raw)
    if (t.kind !== 'jwt') continue
    const p = t.payload
    const id = p.ouId ?? p.org_id ?? p.organization_id
    if (typeof id === 'string')
      return { id, name: String(p.ouName ?? p.org_name ?? p.organization_name ?? id), handle: typeof p.ouHandle === 'string' ? p.ouHandle : undefined }
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

export function sanitizeB2B(input: unknown, base: B2BConfig): B2BConfig {
  const src = (input && typeof input === 'object' ? input : {}) as Partial<B2BConfig>
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
  return {
    style: src.style === 'param' ? 'param' : 'path',
    authorizeTemplate: str(src.authorizeTemplate, base.authorizeTemplate),
    tokenTemplate: str(src.tokenTemplate, base.tokenTemplate),
    paramName: str(src.paramName, base.paramName),
    listTemplate: str(src.listTemplate, base.listTemplate),
    redeemAtOrgTokenEndpoint: typeof src.redeemAtOrgTokenEndpoint === 'boolean' ? src.redeemAtOrgTokenEndpoint : base.redeemAtOrgTokenEndpoint,
    organizations: Array.isArray(src.organizations)
      ? src.organizations
          .filter((o) => o && typeof o.id === 'string')
          .map((o) => ({ id: o.id, name: String(o.name ?? o.id), handle: o.handle ? String(o.handle) : undefined }))
      : [],
  }
}
