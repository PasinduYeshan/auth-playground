// A small external store (useSyncExternalStore) for app-wide state: profiles, the active profile,
// session-only secrets, provider metadata, token sets and the HTTP log.
import { useRef, useSyncExternalStore } from 'react'
import type { ReceivedCode } from '../oauth/authorize'
import type { ProviderMetadata } from '../oauth/discovery'
import { onExchange, type HttpExchange } from '../oauth/http'
import { redactExchange } from '../oauth/redact'
import type { Jwks } from '../oauth/jwt'
import { newProfile, type Profile, type SessionSecrets, type TokenSet } from '../oauth/types'
import { loadActiveProfileId, loadProfiles, saveActiveProfileId, saveProfiles } from './profiles'
import { loadTokenSets, saveTokenSets } from './tokens'

export type ViewName = 'authorize' | 'grants' | 'tokens' | 'organizations' | 'compare' | 'http'

/** One sign-in started from the playground, followed until it ends in tokens or an error. */
export interface SignIn {
  /** The state value of the request. */
  id: string
  label: string
  profileId: string
  startedAt: number
  status: 'waiting' | 'code' | 'redeemed' | 'failed'
  /** What went wrong, or what the server said. */
  message?: string
  tokenSetId?: string
  finishedAt?: number
  /** Set when the request went out by PAR. */
  viaPar?: boolean
  /** Whether the response carried iss (RFC 9207); it matched if the sign-in got this far. */
  iss?: boolean
}

export interface AppState {
  profiles: Profile[]
  activeProfileId: string
  secrets: Record<string, SessionSecrets>
  /** Secrets of other clients used in Other grants, by client ID. Memory only. */
  otherClientSecrets: Record<string, string>
  metadata: Record<string, ProviderMetadata | undefined>
  jwks: Record<string, Jwks | undefined>
  /** The URI each cached JWKS was fetched from, to notice a changed JWKS URI. */
  jwksUri: Record<string, string>
  tokenSets: TokenSet[]
  selectedTokenSetId?: string
  /** Authorization codes received but not redeemed yet. */
  codes: ReceivedCode[]
  /** Sign-ins started from this tab, newest first. */
  signIns: SignIn[]
  /** The received code whose token request is open in the editor. */
  openCode?: ReceivedCode
  /** The server settings drawer. */
  settingsOpen: boolean
  exchanges: HttpExchange[]
  view: ViewName
  revealSecrets: boolean
}

// The HTTP log is kept in sessionStorage (like the tokens it may contain) so the code exchange made on
// the callback page is still visible after returning to the playground. Client secrets are redacted
// from the saved copy; the full entries live in memory for this page only.
const LOG_KEY = 'ap:http-log:v1'
function loadExchanges(): HttpExchange[] {
  try {
    return JSON.parse(sessionStorage.getItem(LOG_KEY) ?? '[]') as HttpExchange[]
  } catch {
    return []
  }
}

// Unredeemed codes sit next to the tokens in sessionStorage, so the choice to redeem survives the
// return from the callback page. A code is single use and short-lived, and is removed once redeemed.
const CODES_KEY = 'ap:codes:v1'
function loadCodes(): ReceivedCode[] {
  try {
    return JSON.parse(sessionStorage.getItem(CODES_KEY) ?? '[]') as ReceivedCode[]
  } catch {
    return []
  }
}

const SIGNINS_KEY = 'ap:signins:v1'
function loadSignIns(): SignIn[] {
  try {
    return JSON.parse(sessionStorage.getItem(SIGNINS_KEY) ?? '[]') as SignIn[]
  } catch {
    return []
  }
}

const VIEWS: ViewName[] = ['authorize', 'grants', 'tokens', 'organizations', 'compare', 'http']
function viewFromHash(): ViewName {
  if (typeof window === 'undefined') return 'authorize'
  const h = window.location.hash.replace('#', '') as ViewName
  return VIEWS.includes(h) ? h : 'authorize'
}

function initialState(): AppState {
  let profiles = loadProfiles()
  if (profiles.length === 0) profiles = [newProfile({ name: 'My first configuration' })]
  const storedActive = loadActiveProfileId()
  const activeProfileId = profiles.some((p) => p.id === storedActive) ? storedActive! : profiles[0].id
  const tokenSets = loadTokenSets()
  return {
    profiles,
    activeProfileId,
    secrets: {},
    otherClientSecrets: {},
    metadata: {},
    jwks: {},
    jwksUri: {},
    tokenSets,
    selectedTokenSetId: tokenSets[0]?.id,
    codes: loadCodes(),
    signIns: loadSignIns(),
    settingsOpen: false,
    exchanges: loadExchanges(),
    view: viewFromHash(),
    revealSecrets: false,
  }
}

let state: AppState = initialState()
const listeners = new Set<() => void>()

export function getState(): AppState {
  return state
}

export function setState(update: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const patch = typeof update === 'function' ? update(state) : update
  const next = { ...state, ...patch }
  if (patch.profiles) saveProfiles(next.profiles)
  if (patch.activeProfileId) saveActiveProfileId(next.activeProfileId)
  if (patch.tokenSets) saveTokenSets(next.tokenSets)
  if (patch.codes) sessionStorage.setItem(CODES_KEY, JSON.stringify(next.codes))
  if (patch.signIns) sessionStorage.setItem(SIGNINS_KEY, JSON.stringify(next.signIns.slice(0, 50)))
  if (patch.exchanges) {
    try {
      // Client secrets stay in memory: the saved copy has them redacted.
      sessionStorage.setItem(LOG_KEY, JSON.stringify(next.exchanges.slice(0, 60).map(redactExchange)))
    } catch {
      // Storage full: the in-memory log still works.
    }
  }
  if (patch.view && typeof window !== 'undefined' && !window.location.pathname.replace(/\/+$/, '').endsWith('/callback'))
    window.history.replaceState(null, '', `#${patch.view}`)
  state = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** Subscribes to a slice of the store. Selectors may build new arrays or objects: results are compared
 * shallowly, so an equal result keeps its previous identity and does not re-render. */
export function useAppState<T>(selector: (s: AppState) => T): T {
  const cache = useRef<{ value: T } | undefined>(undefined)
  const getSnapshot = () => {
    const next = selector(state)
    if (cache.current && shallowEqual(cache.current.value, next)) return cache.current.value
    cache.current = { value: next }
    return next
  }
  return useSyncExternalStore(subscribe, getSnapshot)
}

const MAX_EXCHANGES = 200
onExchange((ex) => setState((s) => ({ exchanges: [ex, ...s.exchanges].slice(0, MAX_EXCHANGES) })))

// ---- actions ----

export function activeProfile(s: AppState = state): Profile {
  return s.profiles.find((p) => p.id === s.activeProfileId) ?? s.profiles[0]
}

export function updateProfile(id: string, patch: Partial<Profile>): void {
  setState((s) => ({
    profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
  }))
}

export function addProfile(p: Profile): void {
  setState((s) => ({ profiles: [...s.profiles, p], activeProfileId: p.id }))
}

export function addProfiles(list: Profile[]): void {
  if (list.length === 0) return
  setState((s) => ({ profiles: [...s.profiles, ...list], activeProfileId: list[0].id }))
}

export function deleteProfile(id: string): void {
  setState((s) => {
    const profiles = s.profiles.filter((p) => p.id !== id)
    const list = profiles.length ? profiles : [newProfile()]
    return { profiles: list, activeProfileId: list[0].id }
  })
}

export function secretsFor(profileId: string, s: AppState = state): SessionSecrets {
  return s.secrets[profileId] ?? { clientSecret: '', introspectionClientSecret: '' }
}

export function setSecrets(profileId: string, patch: Partial<SessionSecrets>): void {
  setState((s) => ({ secrets: { ...s.secrets, [profileId]: { ...secretsFor(profileId, s), ...patch } } }))
}

export function addTokenSet(set: TokenSet): void {
  setState((s) => ({ tokenSets: [set, ...s.tokenSets], selectedTokenSetId: set.id }))
}

export function updateTokenSet(id: string, patch: Partial<TokenSet>): void {
  setState((s) => ({ tokenSets: s.tokenSets.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
}

export function removeTokenSet(id: string): void {
  setState((s) => {
    const tokenSets = s.tokenSets.filter((t) => t.id !== id)
    return { tokenSets, selectedTokenSetId: s.selectedTokenSetId === id ? tokenSets[0]?.id : s.selectedTokenSetId }
  })
}

export function addCode(code: ReceivedCode): void {
  setState((s) => ({ codes: [code, ...s.codes.filter((c) => c.id !== code.id)] }))
}

export function removeCode(id: string): void {
  setState((s) => ({ codes: s.codes.filter((c) => c.id !== id) }))
}

export function upsertSignIn(entry: SignIn): void {
  setState((s) => ({ signIns: [entry, ...s.signIns.filter((x) => x.id !== entry.id)] }))
}

export function updateSignIn(id: string, patch: Partial<SignIn>): void {
  setState((s) => ({ signIns: s.signIns.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
}

export function removeSignIn(id: string): void {
  setState((s) => ({ signIns: s.signIns.filter((x) => x.id !== id), codes: s.codes.filter((c) => c.id !== id), openCode: s.openCode?.id === id ? undefined : s.openCode }))
}
