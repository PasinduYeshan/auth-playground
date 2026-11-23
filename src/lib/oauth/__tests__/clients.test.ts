import { describe, expect, it } from 'vitest'
import { changeIssuer, clientCredentials, credentialsFor, credentialsForSet, introspectionCredentialsFor, newTokenSet, sentClient } from '../../flows'
import { getState, setClientSecret, setState } from '../../store/appStore'
import { exportProfiles, sanitizeProfile } from '../../store/profiles'
import { newProfile, patchProfile, type Profile } from '../types'

const twoClients = (): Profile =>
  patchProfile(newProfile({ clientId: 'web' }), {
    clients: [
      { id: 'default', name: 'Default', clientId: 'web', authMethod: 'none' },
      { id: 'm2m', name: 'Machine', clientId: 'web-m2m', authMethod: 'client_secret_post' },
    ],
  })

describe('named clients', () => {
  it('starts with one client that mirrors the client ID fields', () => {
    const p = newProfile({ clientId: 'web', clientAuthMethod: 'client_secret_post' })
    expect(p.clients).toEqual([{ id: 'default', name: 'Default', clientId: 'web', authMethod: 'client_secret_post' }])
    expect(p.signInClient).toBe('default')
  })

  it('edits the sign-in client through clientId, and switching it changes what sign-in sends', () => {
    let p = twoClients()
    p = patchProfile(p, { clientId: 'web-2' })
    expect(p.clients[0].clientId).toBe('web-2')
    p = patchProfile(p, { signInClient: 'm2m' })
    expect([p.clientId, p.clientAuthMethod]).toEqual(['web-m2m', 'client_secret_post'])
    p = patchProfile(p, { clients: p.clients.filter((c) => c.id !== 'm2m') })
    expect(p.signInClient).toBe('default')
    expect(p.clientId).toBe('web-2')
  })

  it('sends each client with its own in-memory secret', () => {
    const p = twoClients()
    setClientSecret(p.id, 'm2m', 'm2m-secret')
    expect(clientCredentials(p, 'm2m')).toEqual({ clientId: 'web-m2m', method: 'client_secret_post', clientSecret: 'm2m-secret' })
    expect(credentialsFor(p).clientId).toBe('web')
  })

  it('uses the client a token set was issued to, and introspects with the chosen client', () => {
    const p = twoClients()
    setClientSecret(p.id, 'm2m', 'm2m-secret')
    const base = { label: 'x', grant: 'client_credentials' as const, profileId: p.id, response: { access_token: 'a' }, tokenEndpoint: 'https://idp.example/token' }
    const set = newTokenSet({ ...base, client: { clientId: 'web-m2m', method: 'client_secret_post' } })
    expect(credentialsForSet(set, p).clientSecret).toBe('m2m-secret')
    expect(credentialsForSet(newTokenSet(base), p).clientId).toBe('web')
    expect(introspectionCredentialsFor(p, set).clientId).toBe('web-m2m')
    expect(introspectionCredentialsFor({ ...p, introspectionClient: 'default' }, set).clientId).toBe('web')
  })

  it('saves and exports the clients without secrets', () => {
    const p = twoClients()
    setClientSecret(p.id, 'm2m', 'm2m-secret')
    const saved = sanitizeProfile(JSON.parse(JSON.stringify(p)))
    expect(saved.clients.map((c) => c.name)).toEqual(['Default', 'Machine'])
    expect(exportProfiles([saved])).not.toContain('m2m-secret')
  })

  it('turns a configuration saved before named clients into named clients', () => {
    const old = { name: 'old', clientId: 'web', clientAuthMethod: 'none', machineClientId: 'web-m2m', machineAuthMethod: 'client_secret_basic', introspectionClientId: 'web-m2m', introspectionAuthMethod: 'client_secret_basic' }
    const p = sanitizeProfile(old)
    expect(p.clients).toEqual([
      { id: 'default', name: 'Default', clientId: 'web', authMethod: 'none' },
      { id: 'machine', name: 'Machine', clientId: 'web-m2m', authMethod: 'client_secret_basic' },
    ])
    expect(p.introspectionClient).toBe('machine')
    expect(p.clientId).toBe('web')
    expect(sanitizeProfile({ clients: [{ id: 'a', name: 'A', clientId: 'x', authMethod: 'bogus' }] }).clients[0].authMethod).toBe('none')
  })
})

describe('review fixes', () => {
  it('attributes tokens to the client the token request was actually sent as', () => {
    const p = twoClients()
    const form = (pairs: [string, string][]) => ({ url: 'https://idp.example/token', form: pairs, headers: [] as [string, string][] })
    expect(sentClient(form([['client_id', 'web']]), p)).toEqual({ clientId: 'web', method: 'none' })
    expect(sentClient(form([['client_id', 'web-m2m'], ['client_secret', 'x']]), p)).toEqual({ clientId: 'web-m2m', method: 'client_secret_post' })
    const basic = { url: 'https://idp.example/token', form: [] as [string, string][], headers: [['Authorization', `Basic ${btoa('web-m2m:x')}`]] as [string, string][] }
    expect(sentClient(basic, p)).toEqual({ clientId: 'web-m2m', method: 'client_secret_basic' })
  })

  it("drops the previous server's discovery when the base URL changes, keeping typed endpoints", () => {
    const p = newProfile({ issuer: 'https://a.example', expectIss: true, endpoints: { ...newProfile().endpoints, authorization: 'https://a.example/authorize', token: 'https://proxy.example/token' } })
    setState(() => ({ profiles: [p], activeProfileId: p.id, metadata: { [p.id]: { issuer: 'https://a.example', authorization_endpoint: 'https://a.example/authorize', token_endpoint: 'https://a.example/token' } } }))
    changeIssuer(p, 'https://b.example')
    const after = getState().profiles[0]
    expect(after.issuer).toBe('https://b.example')
    expect(after.endpoints.authorization).toBe('')
    expect(after.endpoints.token).toBe('https://proxy.example/token')
    expect(after.expectIss).toBe(false)
    expect(getState().metadata[p.id]).toBeUndefined()
  })

  it('keeps clients with the same ID but different methods apart when converting', () => {
    const p = sanitizeProfile({ clientId: 'web', clientAuthMethod: 'none', machineClientId: 'web-m2m', machineAuthMethod: 'client_secret_post', introspectionClientId: 'web-m2m', introspectionAuthMethod: 'client_secret_basic' })
    expect(p.clients.map((c) => c.authMethod)).toEqual(['none', 'client_secret_post', 'client_secret_basic'])
    expect(p.introspectionClient).toBe('introspection')
  })
})
