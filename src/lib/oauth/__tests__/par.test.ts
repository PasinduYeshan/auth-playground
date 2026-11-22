import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAuthorizationRequest, parAuthorizationUrl, parForm, pushAuthorizationRequest, withPushedRequest } from '../authorize'
import { encodeForm } from '../http'
import { newProfile } from '../types'

const profile = newProfile({
  clientId: 'web',
  redirectUri: 'https://app.example/callback',
  scope: 'openid',
  resources: ['https://api.one', 'https://api.two'],
  endpoints: { ...newProfile().endpoints, authorization: 'https://idp.example/authorize', par: 'https://idp.example/par' },
})

describe('pushed authorization requests (RFC 9126)', () => {
  it('pushes every authorization parameter once, with repeated resources', async () => {
    const req = await buildAuthorizationRequest(profile, { state: 's1', nonce: 'n1' })
    const { form, headers } = parForm(req.params, { clientId: 'web', method: 'none' })
    expect(form.filter(([k]) => k === 'client_id')).toEqual([['client_id', 'web']])
    expect(form.filter(([k]) => k === 'resource').map(([, v]) => v)).toEqual(['https://api.one', 'https://api.two'])
    expect(headers).toEqual({})
    expect(new URLSearchParams(encodeForm(form)).getAll('resource')).toHaveLength(2)
  })

  it('authenticates a confidential client as on the token endpoint', () => {
    const post = parForm([['client_id', 'web'], ['request_uri', 'x']], { clientId: 'web', method: 'client_secret_post', clientSecret: 'shh' })
    expect(post.form).toEqual([['client_id', 'web'], ['client_secret', 'shh']])
    const basic = parForm([['client_id', 'web']], { clientId: 'web', method: 'client_secret_basic', clientSecret: 'shh' })
    expect(basic.headers.Authorization).toMatch(/^Basic /)
    expect(() => parForm([], { clientId: 'web', method: 'client_secret_post' })).toThrow(/client secret/)
  })

  it('redirects with client_id and request_uri only, keeping the transaction', async () => {
    const req = await buildAuthorizationRequest(profile, { state: 's1' })
    const pushed = withPushedRequest(req.pending, 'urn:ietf:params:oauth:request_uri:abc', 90, 1000)
    const url = new URL(pushed.authorizationUrl)
    expect([...url.searchParams.keys()]).toEqual(['client_id', 'request_uri'])
    expect(url.searchParams.get('request_uri')).toBe('urn:ietf:params:oauth:request_uri:abc')
    expect(pushed.state).toBe('s1')
    expect(pushed.codeVerifier).toBe(req.pending.codeVerifier)
    expect(pushed.par).toEqual({ requestUri: 'urn:ietf:params:oauth:request_uri:abc', pushedAt: 1000, expiresAt: 91000 })
    expect(parAuthorizationUrl('https://idp.example/authorize?x=1', 'c', 'u')).toBe('https://idp.example/authorize?x=1&client_id=c&request_uri=u')
  })

  describe('response handling', () => {
    afterEach(() => vi.unstubAllGlobals())
    const respond = (status: number, body: unknown) =>
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })))

    it('reads request_uri and expires_in', async () => {
      respond(201, { request_uri: 'urn:x', expires_in: 60 })
      const r = await pushAuthorizationRequest('https://idp.example/par', [['client_id', 'web']], { clientId: 'web', method: 'none' })
      expect(r).toMatchObject({ requestUri: 'urn:x', expiresIn: 60 })
    })

    it('reports the server error', async () => {
      respond(400, { error: 'invalid_request', error_description: 'Invalid redirect URI' })
      const r = await pushAuthorizationRequest('https://idp.example/par', [['client_id', 'web']], { clientId: 'web', method: 'none' })
      expect(r.requestUri).toBeUndefined()
      expect(r.error).toEqual({ error: 'invalid_request', error_description: 'Invalid redirect URI' })
    })
  })
})
