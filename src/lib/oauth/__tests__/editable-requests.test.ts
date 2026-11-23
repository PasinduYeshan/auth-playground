import { describe, expect, it } from 'vitest'
import { draftCurl } from '../../flows'
import { buildAuthorizationRequest, callbackFromRaw, carryDraft, jsonToParams, paramsToJson, withParams } from '../authorize'
import { templateIssuer } from '../b2b'
import { serverPatch } from '../presets'
import { newProfile } from '../types'

const profile = newProfile({
  clientId: 'web',
  redirectUri: 'https://app.example/callback',
  scope: 'openid',
  resources: ['https://api.one', 'https://api.two'],
  endpoints: { ...newProfile().endpoints, authorization: 'https://idp.example/authorize', token: 'https://idp.example/token' },
})

describe('the authorization request as JSON', () => {
  it('round-trips parameters, with a repeated parameter as a list', async () => {
    const req = await buildAuthorizationRequest(profile, { state: 's1', nonce: 'n1' })
    const json = JSON.parse(paramsToJson(req.params)) as Record<string, unknown>
    expect(json.resource).toEqual(['https://api.one', 'https://api.two'])
    expect(jsonToParams(paramsToJson(req.params))).toEqual(req.params)
  })

  it('sends numbers and booleans as text and rejects nested objects', () => {
    expect(jsonToParams('{"max_age": 0, "x": true, "skip": null}')).toEqual([['max_age', '0'], ['x', 'true']])
    expect(() => jsonToParams('{"claims": {"a": 1}}')).toThrow(/claims/)
    expect(() => jsonToParams('[1]')).toThrow(/object/)
    expect(() => jsonToParams('{')).toThrow(/not valid JSON/)
  })

  it('carries edits over a regeneration: generated values follow, typed values stay', async () => {
    const a = await buildAuthorizationRequest(profile, { state: 'old-state', nonce: 'old-nonce' })
    const b = await buildAuthorizationRequest(profile, { state: 'new-state', nonce: 'new-nonce' })
    const edited = paramsToJson(a.params.map(([k, v]) => (k === 'nonce' ? [k, 'typed'] : k === 'scope' ? [k, 'openid email'] : [k, v])))
    const carried = Object.fromEntries(jsonToParams(carryDraft(edited, a.params, b.params)))
    expect(carried.state).toBe('new-state')
    expect(carried.nonce).toBe('typed')
    expect(carried.scope).toBe('openid email')
    expect(carried.code_challenge).toBe(b.params.find(([k]) => k === 'code_challenge')?.[1])
  })

  it('checks the response against the state and nonce actually sent', async () => {
    const req = await buildAuthorizationRequest(profile, { state: 's1', nonce: 'n1' })
    const params = jsonToParams(paramsToJson(req.params)).filter(([k]) => k !== 'nonce').map(([k, v]): [string, string] => (k === 'state' ? [k, 'mine'] : [k, v]))
    const edited = withParams(req, params)
    expect(edited.pending.state).toBe('mine')
    expect(edited.pending.nonce).toBeUndefined()
    expect(edited.pending.codeVerifier).toBe(req.pending.codeVerifier)
    expect(new URL(edited.url).searchParams.get('state')).toBe('mine')
    expect(edited.pending.authorizationUrl).toBe(edited.url)
  })
})

describe('responses handed over from the sign-in tab', () => {
  it('reads the same fields as the callback page', () => {
    const cb = callbackFromRaw({ code: 'c', state: 's', iss: 'https://idp.example', error_description: 'd' }, 'query')
    expect(cb).toMatchObject({ code: 'c', state: 's', iss: 'https://idp.example', errorDescription: 'd', source: 'query' })
    expect(callbackFromRaw({ state: 1 as unknown as string }, 'query').state).toBeUndefined()
  })
})

describe('the token request draft', () => {
  it('copies as curl with the client secret left as a variable', () => {
    const curl = draftCurl({
      url: 'https://idp.example/token',
      form: [['grant_type', 'authorization_code'], ['client_id', 'web'], ['client_secret', 'shh']],
      headers: [],
    })
    expect(curl).not.toContain('shh')
    expect(curl).toContain('"client_secret=$CLIENT_SECRET"')
  })
})

describe('organization endpoint templates', () => {
  it('uses the issuer, else the authorization endpoint origin', () => {
    expect(templateIssuer({ ...profile, issuer: 'https://idp.example/t/a' })).toBe('https://idp.example/t/a')
    expect(templateIssuer({ ...profile, issuer: '' })).toBe('https://idp.example')
    expect(() => templateIssuer(newProfile())).toThrow(/issuer/)
  })
})

describe('endpoints filled from the base URL', () => {
  const blank = newProfile({ preset: 'thunderid' })

  it('fills the preset paths from the base URL, and the default base URL on choosing the preset', () => {
    const p = { ...blank, ...serverPatch(blank, { issuer: 'http://localhost:9190/' }) }
    expect(p.endpoints.authorization).toBe('http://localhost:9190/oauth2/authorize')
    expect(p.endpoints.token).toBe('http://localhost:9190/oauth2/token')
    const chosen = serverPatch(newProfile(), { preset: 'thunderid' })
    expect(chosen.issuer).toBe('https://localhost:8090')
    expect(chosen.endpoints?.jwks).toBe('https://localhost:8090/oauth2/jwks')
  })

  it('follows a new base URL but keeps endpoints the user changed', () => {
    const a = { ...blank, ...serverPatch(blank, { issuer: 'http://a.example' }) }
    const edited = { ...a, endpoints: { ...a.endpoints, token: 'http://proxy.example/token' } }
    const b = serverPatch(edited, { issuer: 'http://b.example' })
    expect(b.endpoints?.authorization).toBe('http://b.example/oauth2/authorize')
    expect(b.endpoints?.token).toBe('http://proxy.example/token')
  })

  it('fills nothing for an incomplete URL or a preset without known paths', () => {
    expect(serverPatch(blank, { issuer: 'http://' }).endpoints?.authorization).toBe('')
    expect(serverPatch(newProfile(), { issuer: 'https://idp.example' }).endpoints?.authorization).toBe('')
    const filled = { ...blank, ...serverPatch(blank, { issuer: 'http://a.example' }) }
    expect(serverPatch(filled, { preset: 'generic' }).endpoints?.authorization).toBe('')
  })
})
