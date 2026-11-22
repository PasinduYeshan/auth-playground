import { describe, expect, it } from 'vitest'
import { diffClaims, organizationOf, orgEndpoints, resolveTemplate } from '../b2b'
import { base64UrlEncode } from '../encoding'
import { presetById } from '../presets'
import { newProfile, type TokenSet } from '../types'

const enc = (o: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)))
const jwt = (payload: object) => `${enc({ alg: 'RS256' })}.${enc(payload)}.sig`

describe('organization endpoints', () => {
  const profile = newProfile({
    preset: 'thunderid',
    b2b: presetById('thunderid').b2b(),
    issuer: 'https://localhost:8090/',
    endpoints: { ...newProfile().endpoints, authorization: 'https://localhost:8090/oauth2/authorize', token: 'https://localhost:8090/oauth2/token' },
  })
  const org = { id: '019f8c21-4b7e', name: 'Acme' }

  it('resolves ThunderID path templates', () => {
    const ep = orgEndpoints(profile, org)
    expect(ep.authorization).toBe('https://localhost:8090/ou/019f8c21-4b7e/oauth2/authorize')
    expect(ep.token).toBe('https://localhost:8090/ou/019f8c21-4b7e/oauth2/token')
    expect(ep.params).toEqual([])
  })
  it('can redeem at the default token endpoint', () => {
    const ep = orgEndpoints({ ...profile, b2b: { ...profile.b2b, redeemAtOrgTokenEndpoint: false } }, org)
    expect(ep.token).toBe('https://localhost:8090/oauth2/token')
  })
  it('supports parameter style', () => {
    const ep = orgEndpoints({ ...profile, b2b: { ...profile.b2b, style: 'param', paramName: 'organization' } }, org)
    expect(ep.authorization).toBe('https://localhost:8090/oauth2/authorize')
    expect(ep.params).toEqual([['organization', '019f8c21-4b7e']])
  })
  it('encodes the organization in templates', () => {
    expect(resolveTemplate('{issuer}/o/{org}', 'https://idp/', 'a b/c')).toBe('https://idp/o/a%20b%2Fc')
  })
})

describe('organization claims', () => {
  it('defaults to the parameter style for generic servers', () => {
    const generic = newProfile({ endpoints: { ...newProfile().endpoints, authorization: 'https://idp/authorize', token: 'https://idp/token' } })
    expect(orgEndpoints(generic, { id: 'acme', name: 'Acme' })).toEqual({ authorization: 'https://idp/authorize', token: 'https://idp/token', params: [['organization', 'acme']] })
  })
  it('reads configured organization claims, then common ones', () => {
    const custom: TokenSet = {
      id: '2', label: 'x', grant: 'manual', profileId: 'p', obtainedAt: 0,
      response: { access_token: jwt({ tenant: 't-1', tenant_name: 'Tenant One', org_id: 'other' }) },
    }
    expect(organizationOf(custom, { id: 'tenant', name: 'tenant_name', handle: '' })).toEqual({ id: 't-1', name: 'Tenant One', handle: undefined })
    expect(organizationOf(custom)?.id).toBe('other')
  })
  it('reads organization unit claims (ThunderID preset) from the access token', () => {
    const set: TokenSet = {
      id: '1', label: 'x', grant: 'authorization_code', profileId: 'p', obtainedAt: 0,
      response: { access_token: jwt({ ouId: 'ou-1', ouName: 'Initech', ouHandle: 'initech' }) },
    }
    expect(organizationOf(set, presetById('thunderid').b2b().orgClaims)).toEqual({ id: 'ou-1', name: 'Initech', handle: 'initech' })
  })
  it('diffs claims between two tokens', () => {
    const rows = diffClaims({ sub: 'a', ouId: '1', roles: ['x'] }, { sub: 'a', ouId: '2', scope: 'openid' })
    const by = Object.fromEntries(rows.map((r) => [r.claim, r.status]))
    expect(by).toEqual({ ouId: 'changed', roles: 'removed', scope: 'added', sub: 'same' })
  })
})
