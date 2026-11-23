import { describe, expect, it } from 'vitest'
import { clientCredentials, credentialsFor, credentialsForSet, introspectionCredentialsFor, newTokenSet } from '../../flows'
import { setClientSecret } from '../../store/appStore'
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
