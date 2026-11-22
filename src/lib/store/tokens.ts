// Token sets live in sessionStorage: they survive the redirect round trip and a reload of this tab,
// but are dropped when the tab closes and are never shared with other tabs or written to disk.
import type { TokenSet } from '../oauth/types'

const KEY = 'ap:token-sets:v1'

export function loadTokenSets(): TokenSet[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as TokenSet[]) : []
  } catch {
    return []
  }
}

export function saveTokenSets(sets: TokenSet[]): void {
  sessionStorage.setItem(KEY, JSON.stringify(sets))
}

export function clearTokenSets(): void {
  sessionStorage.removeItem(KEY)
}
