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

export function exportProfile(p: Profile): string {
  const { id: _id, updatedAt: _u, ...rest } = sanitizeProfile(p)
  void _id
  void _u
  return JSON.stringify(rest, null, 2)
}

export function importProfile(json: string): Profile {
  const parsed = JSON.parse(json) as unknown
  return { ...sanitizeProfile(parsed), id: crypto.randomUUID(), updatedAt: Date.now() }
}
