import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoveredIssuer, mergeRefreshResponse } from '../../flows'
import { isSecretParam, sanitizeProfile } from '../../store/profiles'
import { checkCallback, type CallbackParams, type PendingAuthorization } from '../authorize'
import { tracedFetch, type HttpExchange } from '../http'
import { redactExchange, toCurl } from '../redact'
import { newProfile } from '../types'
import { displayUrl, isHttpUrl, requireHttpUrl } from '../url'

describe('endpoint URLs', () => {
  it('accepts absolute http(s) URLs only', () => {
    expect(isHttpUrl('https://idp.example/token')).toBe(true)
    expect(isHttpUrl('h')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
    expect(isHttpUrl('/oauth2/token')).toBe(false)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(() => requireHttpUrl('h', 'token endpoint')).toThrow(/token endpoint \(h\) is not an absolute/)
    expect(displayUrl('h')).toBe('h')
    expect(displayUrl('https://idp.example/a/b?x=1', 'path')).toBe('/a/b')
  })

  describe('tracedFetch', () => {
    afterEach(() => vi.unstubAllGlobals())
    it('sends nothing to a relative or empty URL', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const ex = await tracedFetch({ label: 'List', url: '', headers: { Authorization: 'Bearer t' } })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(ex.networkError).toMatch(/not an absolute/)
    })
  })
})

const exchange = (headers: Record<string, string>, body?: string): HttpExchange => ({
  id: 'x',
  label: 'Token',
  startedAt: 0,
  durationMs: 0,
  request: { method: 'POST', url: 'https://idp.example/token', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body },
})

describe('client secrets in the log and curl', () => {
  it('redacts client secrets and Basic credentials before storage, keeping the rest', () => {
    const r = redactExchange(exchange({ Authorization: 'Basic d2ViOnNoaA==' }, 'grant_type=client_credentials&client_id=web&client_secret=shh'))
    expect(r.request.headers.Authorization).toBe('Basic [redacted]')
    const form = new URLSearchParams(r.request.body)
    expect(form.get('client_secret')).toBe('[redacted]')
    expect(form.get('client_id')).toBe('web')
    // Bearer tokens are not client secrets and stay, like the token sets beside the log.
    expect(redactExchange(exchange({ Authorization: 'Bearer abc' })).request.headers.Authorization).toBe('Bearer abc')
  })

  it('copies curl with $CLIENT_SECRET unless secrets are revealed', () => {
    const ex = exchange({ Authorization: 'Basic d2ViOnNoaA==' }, 'code=c1&client_secret=shh')
    const hidden = toCurl(ex.request)
    expect(hidden).not.toContain('shh')
    expect(hidden).not.toContain('d2ViOnNoaA==')
    expect(hidden).toContain(`-u 'web':"$CLIENT_SECRET"`)
    expect(hidden).toContain(`"client_secret=$CLIENT_SECRET"`)
    expect(hidden).toContain(`'code=c1'`)
    expect(toCurl(ex.request, true)).toContain('client_secret=shh')
  })
})

describe('issuer identification (RFC 9207)', () => {
  const pending = (expectIss: boolean) => ({ state: 's', profile: newProfile({ issuer: 'https://idp.example', expectIss }) }) as PendingAuthorization
  const cb = (iss?: string): CallbackParams => ({ raw: {}, source: 'query', code: 'c', state: 's', iss })
  it('rejects a response without iss when the server advertises it', () => {
    expect(checkCallback(cb(), pending(true)).ok).toBe(false)
    expect(checkCallback(cb(), pending(false)).ok).toBe(true)
    expect(checkCallback(cb('https://idp.example'), pending(true)).ok).toBe(true)
    expect(checkCallback(cb('https://other-issuer.example'), pending(false)).ok).toBe(false)
  })

  it('saves the exact metadata issuer, trailing slash included', () => {
    expect(discoveredIssuer('https://t.auth0.com', 'https://t.auth0.com/')).toBe('https://t.auth0.com/')
    expect(discoveredIssuer('https://idp.example/', 'https://idp.example')).toBe('https://idp.example')
    expect(discoveredIssuer('https://idp.example/.well-known/openid-configuration', 'https://idp.example')).toBe('https://idp.example')
    expect(discoveredIssuer('https://typed.example', 'https://other.example')).toBe('https://typed.example')
  })
})

describe('refresh responses (RFC 6749 §6)', () => {
  it('keeps the earlier refresh and ID tokens when the server sends no new ones', () => {
    expect(mergeRefreshResponse({ access_token: 'a1', refresh_token: 'r1', id_token: 'i1' }, { access_token: 'a2' })).toEqual({ access_token: 'a2', refresh_token: 'r1', id_token: 'i1' })
    expect(mergeRefreshResponse({ access_token: 'a1', refresh_token: 'r1' }, { access_token: 'a2', refresh_token: 'r2' }).refresh_token).toBe('r2')
  })
})

describe('saved configurations', () => {
  it('keeps hint and type parameters, drops credentials', () => {
    for (const name of ['id_token_hint', 'login_hint_token', 'subject_token_type', 'requested_token_type', 'claims']) expect(isSecretParam(name)).toBe(false)
    for (const name of ['client_secret', 'password', 'refresh_token', 'access_token', 'code_verifier', 'client_assertion', 'subject_token', 'device_secret']) expect(isSecretParam(name)).toBe(true)
  })

  it('keeps known endpoint names with string values only', () => {
    const p = sanitizeProfile({ endpoints: { token: 'https://idp.example/token', userinfo: 42, extra: 'https://x' } })
    expect(p.endpoints.token).toBe('https://idp.example/token')
    expect(p.endpoints.userinfo).toBe('')
    expect('extra' in p.endpoints).toBe(false)
  })
})
