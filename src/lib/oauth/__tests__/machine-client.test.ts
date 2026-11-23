import { describe, expect, it } from 'vitest'
import { credentialsForSet, machineCredentialsFor, newTokenSet } from '../../flows'
import { setSecrets } from '../../store/appStore'
import { exportProfiles, sanitizeProfile } from '../../store/profiles'
import { newProfile } from '../types'

const profile = newProfile({ clientId: 'web', clientAuthMethod: 'none', machineClientId: 'web-m2m', machineAuthMethod: 'client_secret_post' })

describe('the machine client', () => {
  it('sends its own ID, method and in-memory secret', () => {
    setSecrets(profile.id, { machineClientSecret: 'm2m-secret' })
    expect(machineCredentialsFor(profile)).toEqual({ clientId: 'web-m2m', method: 'client_secret_post', clientSecret: 'm2m-secret' })
  })

  it('is used again for the tokens it was issued', () => {
    setSecrets(profile.id, { machineClientSecret: 'm2m-secret' })
    const base = { label: 'x', grant: 'client_credentials' as const, profileId: profile.id, response: { access_token: 'a' }, tokenEndpoint: 'https://idp.example/token' }
    const machineSet = newTokenSet({ ...base, client: { clientId: 'web-m2m', method: 'client_secret_post' } })
    expect(credentialsForSet(machineSet, profile).clientSecret).toBe('m2m-secret')
    expect(credentialsForSet(newTokenSet(base), profile).clientId).toBe('web')
  })

  it('is saved and exported without its secret', () => {
    const saved = sanitizeProfile(JSON.parse(JSON.stringify(profile)))
    expect(saved.machineClientId).toBe('web-m2m')
    expect(saved.machineAuthMethod).toBe('client_secret_post')
    expect(exportProfiles([saved])).not.toContain('m2m-secret')
    expect(sanitizeProfile({ name: 'old file' }).machineClientId).toBe('')
  })
})
