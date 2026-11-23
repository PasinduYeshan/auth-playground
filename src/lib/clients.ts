// Adding, changing and removing a configuration's named clients.
import type { ClientAuthMethod, ClientConfig, Profile } from './oauth/types'
import { setClientSecret, updateProfile } from './store/appStore'

export const AUTH_METHOD_LABELS: Record<ClientAuthMethod, string> = {
  none: 'none (public client)',
  client_secret_post: 'client_secret_post',
  client_secret_basic: 'client_secret_basic',
}

/** Adds a client to the configuration and returns its id. */
export function addClient(profile: Profile, patch: Partial<ClientConfig> = {}): string {
  const id = crypto.randomUUID()
  const taken = new Set(profile.clients.map((c) => c.name))
  let n = profile.clients.length + 1
  while (taken.has(`Client ${n}`)) n++
  updateProfile(profile.id, { clients: [...profile.clients, { id, name: `Client ${n}`, clientId: '', authMethod: 'none', ...patch }] })
  return id
}

export function updateClient(profile: Profile, id: string, patch: Partial<ClientConfig>): void {
  updateProfile(profile.id, { clients: profile.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
}

export function removeClient(profile: Profile, id: string): void {
  if (profile.clients.length < 2) return
  updateProfile(profile.id, { clients: profile.clients.filter((c) => c.id !== id) })
  setClientSecret(profile.id, id, '')
}
