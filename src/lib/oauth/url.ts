// Endpoint values are typed by hand and saved on every keystroke, so they are often incomplete.
// Everything that parses or calls one goes through these helpers instead of `new URL` directly.

/** True for an absolute http: or https: URL. */
export function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Parses an absolute http(s) URL, or throws a message that names the field. */
export function requireHttpUrl(value: string | undefined, what: string): URL {
  if (!value) throw new Error(`Set the ${what} first.`)
  if (!isHttpUrl(value)) throw new Error(`The ${what} (${value}) is not an absolute http(s) URL.`)
  return new URL(value)
}

/** host + path for display; the raw value when it does not parse. */
export function displayUrl(value: string | undefined, part: 'hostPath' | 'path' = 'hostPath'): string {
  if (!value) return '?'
  if (!isHttpUrl(value)) return value
  const u = new URL(value)
  return part === 'path' ? u.pathname : u.host + u.pathname
}
