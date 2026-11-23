// Saved configurations. Only non-secret fields are ever written to localStorage: the Profile type has
// no secret fields, and sanitizeProfile drops anything unexpected (for example from an import).
import { sanitizeB2B } from '../oauth/b2b'
import { presetById } from '../oauth/presets'
import { DEFAULT_CLIENT, newProfile, withSignInClient, type ClientAuthMethod, type ClientConfig, type Profile } from '../oauth/types'

const KEY = 'ap:profiles:v1'
const ACTIVE_KEY = 'ap:active-profile'

// Parameter names that carry a credential. Hints and type names (id_token_hint, login_hint_token,
// subject_token_type, requested_token_type) are not credentials and are kept.
const SECRET_NAMES = new Set(['access_token', 'refresh_token', 'id_token', 'token', 'subject_token', 'actor_token', 'device_secret', 'device_code', 'code', 'code_verifier', 'client_assertion', 'assertion'])
export function isSecretParam(name: string): boolean {
  const n = name.trim().toLowerCase()
  return SECRET_NAMES.has(n) || /secret|password/.test(n)
}

export function sanitizeProfile(input: unknown): Profile {
  const base = newProfile()
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(base) as (keyof Profile)[]) {
    if (key in src && typeof src[key] === typeof base[key]) out[key] = src[key]
  }
  // Known endpoint names with string values only: an imported file cannot add anything else.
  const endpoints = (src.endpoints && typeof src.endpoints === 'object' ? src.endpoints : {}) as Record<string, unknown>
  out.endpoints = Object.fromEntries(Object.entries(base.endpoints).map(([k, v]) => [k, typeof endpoints[k] === 'string' ? endpoints[k] : v]))
  // Extra parameters are free-form: drop any whose name looks like a credential.
  for (const listKey of ['extraAuthParams', 'extraTokenParams'] as const) {
    const list = Array.isArray(src[listKey]) ? (src[listKey] as Profile['extraAuthParams']) : []
    out[listKey] = list
      .filter((p) => p && typeof p.key === 'string' && !isSecretParam(p.key))
      .map((p) => ({ key: p.key, value: String(p.value ?? ''), enabled: p.enabled !== false }))
  }
  out.preset = presetById(typeof src.preset === 'string' ? src.preset : undefined).id
  out.b2b = sanitizeB2B(src.b2b, presetById(out.preset as string).b2b())
  out.resources = Array.isArray(src.resources) ? (src.resources as unknown[]).map(String) : []
  Object.assign(out, sanitizeClients(src, out as unknown as Profile))
  return withSignInClient(out as unknown as Profile)
}

export function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as unknown[]
    return Array.isArray(list) ? list.map(sanitizeProfile) : []
  } catch {
    return []
  }
}

export function saveProfiles(profiles: Profile[]): void {
  localStorage.setItem(KEY, JSON.stringify(profiles.map(sanitizeProfile)))
}

export function loadActiveProfileId(): string | null {
  return localStorage.getItem(ACTIVE_KEY)
}

export function saveActiveProfileId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id)
}

// Configuration files. The envelope names the format so other JSON is refused with a clear message;
// a bare configuration object (the earlier copy format) is accepted too.
export const CONFIG_FILE_FORMAT = 'auth-playground/configurations'
export const CONFIG_FILE_VERSION = 1
export const MAX_IMPORT_BYTES = 1024 * 1024

function portable(p: Profile): Omit<Profile, 'id' | 'updatedAt'> {
  const { id: _id, updatedAt: _u, ...rest } = sanitizeProfile(p)
  void _id
  void _u
  return rest
}

export function exportProfiles(profiles: Profile[]): string {
  return JSON.stringify(
    { format: CONFIG_FILE_FORMAT, version: CONFIG_FILE_VERSION, exportedAt: new Date().toISOString(), configurations: profiles.map(portable) },
    null,
    2,
  )
}

/** A file name such as auth-playground-my-idp.json, or auth-playground-configurations.json for several. */
export function exportFileName(profiles: Profile[]): string {
  const slug =
    profiles.length === 1
      ? profiles[0].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'configuration'
      : 'configurations'
  return `auth-playground-${slug}.json`
}

/** Parses an exported file into new profiles (fresh IDs, secrets dropped). Throws with a readable message. */
export function parseConfigFile(text: string, existingNames: string[] = []): Profile[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('The file does not contain a configuration.')
  const obj = parsed as Record<string, unknown>
  let items: unknown[]
  if (obj.format !== undefined) {
    if (obj.format !== CONFIG_FILE_FORMAT) throw new Error('This is not an Auth Playground configuration file.')
    if (typeof obj.version === 'number' && obj.version > CONFIG_FILE_VERSION)
      throw new Error('The file was made by a newer version of Auth Playground.')
    if (!Array.isArray(obj.configurations)) throw new Error('The file has no configurations.')
    items = obj.configurations
  } else if ('endpoints' in obj || 'clientId' in obj || 'issuer' in obj) {
    items = [obj]
  } else {
    throw new Error('This is not an Auth Playground configuration file.')
  }
  if (items.length === 0) throw new Error('The file has no configurations.')
  const names = new Set(existingNames)
  return items.map((item) => {
    const p = { ...sanitizeProfile(item), id: crypto.randomUUID(), updatedAt: Date.now() }
    let name = p.name
    for (let i = 2; names.has(name); i++) name = `${p.name} (${i})`
    names.add(name)
    return { ...p, name }
  })
}

const AUTH_METHODS: ClientAuthMethod[] = ['none', 'client_secret_post', 'client_secret_basic']
const authMethod = (v: unknown, fallback: ClientAuthMethod): ClientAuthMethod => (AUTH_METHODS.includes(v as ClientAuthMethod) ? (v as ClientAuthMethod) : fallback)

/** The client list from a saved or imported profile. A profile saved before named clients had a
 * sign-in client and optional machine and introspection clients: those become named clients. */
function sanitizeClients(src: Record<string, unknown>, base: Profile): Pick<Profile, 'clients' | 'signInClient' | 'introspectionClient' | 'clientAuthMethod'> {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  if (Array.isArray(src.clients) && src.clients.length) {
    const seen = new Set<string>()
    const clients: ClientConfig[] = []
    for (const raw of src.clients as Record<string, unknown>[]) {
      const id = str(raw?.id).slice(0, 64)
      if (!id || seen.has(id)) continue
      seen.add(id)
      clients.push({ id, name: str(raw.name).slice(0, 80) || 'Client', clientId: str(raw.clientId), authMethod: authMethod(raw.authMethod, 'none') })
    }
    if (clients.length) return { clients, signInClient: str(src.signInClient), introspectionClient: str(src.introspectionClient), clientAuthMethod: base.clientAuthMethod }
  }
  const method = authMethod(src.clientAuthMethod, 'none')
  const clients: ClientConfig[] = [{ id: DEFAULT_CLIENT, name: 'Default', clientId: base.clientId, authMethod: method }]
  const add = (id: string, name: string, clientId: string, m: ClientAuthMethod): string => {
    const same = clients.find((c) => c.clientId === clientId)
    if (same) return same.id
    clients.push({ id, name, clientId, authMethod: m })
    return id
  }
  const machine = str(src.machineClientId).trim()
  if (machine) add('machine', 'Machine', machine, authMethod(src.machineAuthMethod, 'client_secret_post'))
  const intro = str(src.introspectionClientId).trim()
  const introspectionClient = intro ? add('introspection', 'Introspection', intro, authMethod(src.introspectionAuthMethod, 'client_secret_basic')) : ''
  return { clients, signInClient: DEFAULT_CLIENT, introspectionClient, clientAuthMethod: method }
}
