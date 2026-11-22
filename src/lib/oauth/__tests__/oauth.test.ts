import { describe, expect, it, beforeEach } from 'vitest'
import { computeCodeChallenge, generateCodeVerifier, isValidCodeVerifier } from '../pkce'
import { base64UrlEncode, base64UrlDecodeToString } from '../encoding'
import { checkIdTokenClaims, decodeToken, halfHash, verifySignature, type Jwks } from '../jwt'
import { buildAuthorizationRequest, checkCallback, parseCallback, savePending, takePending } from '../authorize'
import { basicAuthHeader, applyClientAuth } from '../client'
import { discoveryUrls } from '../discovery'
import { newProfile } from '../types'
import { exportFileName, exportProfiles, parseConfigFile, sanitizeProfile } from '../../store/profiles'

const enc = (o: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)))

async function signJwt(header: object, payload: object, alg: 'RS256' | 'ES256' = 'RS256') {
  const params =
    alg === 'RS256'
      ? { gen: { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, sign: { name: 'RSASSA-PKCS1-v1_5' } }
      : { gen: { name: 'ECDSA', namedCurve: 'P-256' }, sign: { name: 'ECDSA', hash: 'SHA-256' } }
  const kp = (await crypto.subtle.generateKey(params.gen, true, ['sign', 'verify'])) as CryptoKeyPair
  const input = `${enc({ alg, ...header })}.${enc(payload)}`
  const sig = new Uint8Array(await crypto.subtle.sign(params.sign, kp.privateKey, new TextEncoder().encode(input)))
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey
  return { token: `${input}.${base64UrlEncode(sig)}`, jwks: { keys: [{ ...jwk, kid: 'k1', use: 'sig', alg }] } as Jwks }
}

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B vector', async () => {
    expect(await computeCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'S256')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
  it('generates valid verifiers', () => {
    const v = generateCodeVerifier()
    expect(v).toHaveLength(43)
    expect(isValidCodeVerifier(v)).toBe(true)
    expect(generateCodeVerifier()).not.toBe(v)
  })
})

describe('JWT', () => {
  it('decodes JWT, JWE and opaque tokens', () => {
    expect(decodeToken(`${enc({ alg: 'RS256' })}.${enc({ sub: 'a' })}.sig`).kind).toBe('jwt')
    expect(decodeToken(`${enc({ alg: 'RSA-OAEP', enc: 'A256GCM' })}.a.b.c.d`).kind).toBe('jwe')
    expect(decodeToken('opaque-token-value').kind).toBe('opaque')
  })
  it.each(['RS256', 'ES256'] as const)('verifies %s signatures and rejects tampering', async (alg) => {
    const { token, jwks } = await signJwt({ kid: 'k1' }, { sub: 'alice' }, alg)
    expect((await verifySignature(decodeToken(token), jwks)).status).toBe('valid')
    const [h, , s] = token.split('.')
    const tampered = `${h}.${enc({ sub: 'mallory' })}.${s}`
    expect((await verifySignature(decodeToken(tampered), jwks)).status).toBe('invalid')
  })
  it('flags alg none and an unknown kid', async () => {
    const none = decodeToken(`${enc({ alg: 'none' })}.${enc({})}.`)
    expect((await verifySignature(none, { keys: [] })).status).toBe('invalid')
    // An unknown kid may be a rotated key: unverified, flagged so the caller fetches the JWKS again.
    const { token, jwks } = await signJwt({ kid: 'other' }, {})
    expect(await verifySignature(decodeToken(token), jwks)).toMatchObject({ status: 'unverified', unknownKey: true })
  })
  it('checks ID token claims', async () => {
    const now = 1_800_000_000
    const at = 'access-token-value'
    const atHash = await halfHash(at, 'RS256')
    const tok = decodeToken(`${enc({ alg: 'RS256' })}.${enc({ iss: 'https://idp', sub: 'u1', aud: 'c1', exp: now + 60, iat: now, nonce: 'n1', at_hash: atHash })}.x`)
    const checks = await checkIdTokenClaims(tok, { issuer: 'https://idp', audience: 'c1', nonce: 'n1', accessToken: at, now })
    expect(checks.every((c) => c.status === 'pass')).toBe(true)
    const bad = await checkIdTokenClaims(tok, { issuer: 'https://other', audience: 'c2', nonce: 'n2', now: now + 3600 })
    expect(bad.filter((c) => c.status === 'fail').map((c) => c.name).sort()).toEqual(['aud', 'exp', 'iss', 'nonce'])
  })
  it('checks azp, sub and auth_time (OIDC Core)', async () => {
    const now = 1_800_000_000
    const tok = (claims: object) => decodeToken(`${enc({ alg: 'RS256' })}.${enc({ iss: 'https://idp', aud: 'c1', exp: now + 60, iat: now, ...claims })}.x`)
    const fails = async (claims: object, extra = {}) =>
      (await checkIdTokenClaims(tok(claims), { audience: 'c1', now, ...extra })).filter((c) => c.status === 'fail').map((c) => c.name)
    expect(await fails({ sub: 'u', azp: 'someone-else' })).toEqual(['azp'])
    expect(await fails({})).toEqual(['sub'])
    expect(await fails({ sub: 'u' }, { maxAge: 300 })).toEqual(['auth_time'])
    expect(await fails({ sub: 'u', auth_time: now - 10 }, { maxAge: 300 })).toEqual([])
  })
})

describe('authorization request and callback', () => {
  beforeEach(() => sessionStorage.clear())
  const profile = newProfile({
    issuer: 'https://idp.example',
    clientId: 'spa',
    redirectUri: 'https://app.example/callback',
    scope: 'openid  profile',
    resources: ['https://api.example', 'https://api2.example'],
    prompt: 'login',
    endpoints: { ...newProfile().endpoints, authorization: 'https://idp.example/oauth2/authorize' },
    extraAuthParams: [{ key: 'claims', value: '{"id_token":{}}', enabled: true }, { key: 'off', value: 'x', enabled: false }],
  })
  it('builds a PKCE request with all parameters', async () => {
    const req = await buildAuthorizationRequest(profile, { state: 's1', nonce: 'n1', codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' })
    const url = new URL(req.url)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('openid profile')
    expect(url.searchParams.get('code_challenge')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.getAll('resource')).toEqual(['https://api.example', 'https://api2.example'])
    expect(url.searchParams.get('prompt')).toBe('login')
    expect(url.searchParams.get('claims')).toBe('{"id_token":{}}')
    expect(url.searchParams.has('off')).toBe(false)
  })
  it('lets per-run overrides replace or remove parameters', async () => {
    const req = await buildAuthorizationRequest(profile, { overrides: [['prompt', ''], ['org', 'acme']] })
    const url = new URL(req.url)
    expect(url.searchParams.has('prompt')).toBe(false)
    expect(url.searchParams.get('org')).toBe('acme')
  })
  it('accepts a callback once and checks iss', async () => {
    const req = await buildAuthorizationRequest(profile, { state: 's2' })
    savePending(req.pending)
    const cb = parseCallback({ search: '?code=c&state=s2&iss=https%3A%2F%2Fidp.example', hash: '' })!
    expect(cb.code).toBe('c')
    const pending = takePending('s2')
    expect(checkCallback(cb, pending).ok).toBe(true)
    expect(takePending('s2')).toBeUndefined()
    expect(checkCallback({ ...cb, iss: 'https://evil' }, pending).ok).toBe(false)
    expect(checkCallback(cb, undefined).ok).toBe(false)
  })
  it('parses errors from the fragment', () => {
    const cb = parseCallback({ search: '', hash: '#error=access_denied&state=x' })!
    expect(cb.source).toBe('fragment')
    expect(cb.error).toBe('access_denied')
    expect(parseCallback({ search: '', hash: '' })).toBeUndefined()
  })
})

describe('client authentication', () => {
  it('form-encodes Basic credentials (RFC 6749 §2.3.1)', () => {
    expect(basicAuthHeader('a b', 'p:w%')).toBe(`Basic ${btoa('a+b:p%3Aw%25')}`)
  })
  it('sends client_id only for public clients and never the secret', () => {
    const form: Record<string, string | undefined> = {}
    const headers: Record<string, string> = {}
    applyClientAuth({ clientId: 'spa', method: 'none', clientSecret: 'shh' }, form, headers)
    expect(form).toEqual({ client_id: 'spa' })
    expect(headers.Authorization).toBeUndefined()
  })
  it('requires a secret for confidential methods', () => {
    expect(() => applyClientAuth({ clientId: 'c', method: 'client_secret_basic' }, {}, {})).toThrow()
  })
})

describe('discovery URLs', () => {
  it('handles issuers with and without paths', () => {
    expect(discoveryUrls('https://idp.example/')).toEqual([
      'https://idp.example/.well-known/openid-configuration',
      'https://idp.example/.well-known/oauth-authorization-server',
    ])
    expect(discoveryUrls('https://idp.example/t/acme')[1]).toBe('https://idp.example/.well-known/oauth-authorization-server/t/acme')
    expect(discoveryUrls('https://idp.example/.well-known/openid-configuration')).toHaveLength(1)
  })
})

describe('profile storage', () => {
  it('drops secret-looking fields on import and export', () => {
    const p = sanitizeProfile({
      ...newProfile({ clientId: 'spa' }),
      clientSecret: 'leak',
      extraTokenParams: [{ key: 'client_secret', value: 'leak', enabled: true }, { key: 'audience', value: 'x', enabled: true }],
    })
    const json = exportProfiles([p])
    expect(json).not.toContain('leak')
    expect(parseConfigFile(json)[0].extraTokenParams.map((x) => x.key)).toEqual(['audience'])
    expect(base64UrlDecodeToString(base64UrlEncode(new TextEncoder().encode('ok')))).toBe('ok')
  })
})

describe('configuration files', () => {
  const a = newProfile({ name: 'My IdP', clientId: 'a' })
  const b = newProfile({ name: 'Other', clientId: 'b' })
  it('round-trips several configurations with fresh IDs and unique names', () => {
    const imported = parseConfigFile(exportProfiles([a, b]), ['My IdP'])
    expect(imported.map((p) => p.name)).toEqual(['My IdP (2)', 'Other'])
    expect(imported.map((p) => p.clientId)).toEqual(['a', 'b'])
    expect(imported[0].id).not.toBe(a.id)
  })
  it('accepts a bare configuration object', () => {
    const { id: _i, updatedAt: _u, ...bare } = a
    void _i
    void _u
    expect(parseConfigFile(JSON.stringify(bare))[0].clientId).toBe('a')
  })
  it('refuses other files with a readable message', () => {
    expect(() => parseConfigFile('not json')).toThrow('not valid JSON')
    expect(() => parseConfigFile('{"name":"x"}')).toThrow('not an Auth Playground configuration file')
    expect(() => parseConfigFile('{"format":"other","configurations":[]}')).toThrow('not an Auth Playground configuration file')
    expect(() => parseConfigFile('{"format":"auth-playground/configurations","version":99,"configurations":[{}]}')).toThrow('newer version')
  })
  it('names files after the configuration', () => {
    expect(exportFileName([a])).toBe('auth-playground-my-idp.json')
    expect(exportFileName([a, b])).toBe('auth-playground-configurations.json')
  })
})
