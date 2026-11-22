// Saved configurations. Only non-secret fields are ever written to localStorage: the Profile type has
// no secret fields, and sanitizeProfile drops anything unexpected (for example from an import).
import { sanitizeB2B } from '../oauth/b2b'
import { presetById } from '../oauth/presets'
import { newProfile, type Profile } from '../oauth/types'

const KEY = 'ap:profiles:v1'
const ACTIVE_KEY = 'ap:active-profile'

const SECRET_LIKE = /secret|password|token|verifier|assertion/i

export function sanitizeProfile(input: unknown): Profile {
  const base = newProfile()
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(base) as (keyof Profile)[]) {
    if (key in src && typeof src[key] === typeof base[key]) out[key] = src[key]
  }
  out.endpoints = { ...base.endpoints, ...(typeof src.endpoints === 'object' ? (src.endpoints as object) : {}) }
  // Extra parameters are free-form: drop any whose name looks like a credential.
  for (const listKey of ['extraAuthParams', 'extraTokenParams'] as const) {
    const list = Array.isArray(src[listKey]) ? (src[listKey] as Profile['extraAuthParams']) : []
    out[listKey] = list
      .filter((p) => p && typeof p.key === 'string' && !SECRET_LIKE.test(p.key))
      .map((p) => ({ key: p.key, value: String(p.value ?? ''), enabled: p.enabled !== false }))
  }
  out.preset = presetById(typeof src.preset === 'string' ? src.preset : undefined).id
  out.b2b = sanitizeB2B(src.b2b, presetById(out.preset as string).b2b())
  out.resources = Array.isArray(src.resources) ? (src.resources as unknown[]).map(String) : []
  return out as unknown as Profile
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
