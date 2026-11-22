// Masking for display, redaction for storage, and curl export of recorded exchanges.
import { maskValue, SENSITIVE_FIELDS, type HttpExchange, type HttpRequestRecord } from './http'

/** Client secrets: never written to storage and never copied unless the user reveals secrets. */
const CLIENT_SECRET_FIELDS = ['client_secret']
const REDACTED = '[redacted]'

export function maskHeaders(headers: Record<string, string>, reveal: boolean): Record<string, string> {
  if (reveal) return headers
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'authorization') {
      const [scheme, cred] = v.split(' ')
      out[k] = `${scheme} ${maskValue(cred ?? '')}`
    } else out[k] = v
  }
  return out
}

export function maskForm(body: string, reveal: boolean): [string, string][] {
  return [...new URLSearchParams(body).entries()].map(([k, v]) => [k, !reveal && SENSITIVE_FIELDS.includes(k) ? maskValue(v) : v])
}

export function maskJson(value: unknown, reveal: boolean): unknown {
  if (reveal || !value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => maskJson(v, reveal))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_FIELDS.includes(k) && typeof v === 'string' ? maskValue(v) : maskJson(v, reveal)
  return out
}

const isForm = (r: HttpRequestRecord) => r.headers['Content-Type'] === 'application/x-www-form-urlencoded'

/** The copy of an exchange that may be saved to sessionStorage: client secrets and Basic credentials
 * removed. Tokens stay, as the token sets beside them in sessionStorage hold them too. */
export function redactExchange(ex: HttpExchange): HttpExchange {
  const headers = { ...ex.request.headers }
  for (const k of Object.keys(headers)) if (k.toLowerCase() === 'authorization' && /^basic /i.test(headers[k])) headers[k] = `Basic ${REDACTED}`
  let body = ex.request.body
  if (body && isForm(ex.request)) {
    const params = new URLSearchParams(body)
    for (const f of CLIENT_SECRET_FIELDS) if (params.has(f)) params.set(f, REDACTED)
    body = params.toString()
  }
  return { ...ex, request: { ...ex.request, headers, body } }
}

export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** The client ID inside a Basic header (RFC 6749 §2.3.1 form-encodes it before base64). */
function basicClientId(header: string): string | undefined {
  try {
    const decoded = atob(header.replace(/^basic\s+/i, ''))
    return decodeURIComponent(decoded.slice(0, decoded.indexOf(':')).replace(/\+/g, ' '))
  } catch {
    return undefined
  }
}

/** A curl command for a request. Unless reveal is on, a client secret becomes "$CLIENT_SECRET", so the
 * secret itself never reaches the clipboard. Codes and tokens are kept: the command needs them. */
export function toCurl(req: HttpRequestRecord, reveal = false): string {
  const parts = ['curl', '-i']
  if (req.method !== 'GET') parts.push('-X', req.method)
  for (const [k, v] of Object.entries(req.headers)) {
    if (!reveal && k.toLowerCase() === 'authorization' && /^basic /i.test(v)) {
      parts.push('-u', `${shellQuote(basicClientId(v) ?? 'CLIENT_ID')}:"$CLIENT_SECRET"`)
      continue
    }
    parts.push('-H', shellQuote(`${k}: ${v}`))
  }
  if (req.body && isForm(req)) {
    for (const [k, v] of new URLSearchParams(req.body)) {
      if (!reveal && CLIENT_SECRET_FIELDS.includes(k)) parts.push('--data-urlencode', `"${k}=$CLIENT_SECRET"`)
      else parts.push('--data-urlencode', shellQuote(`${k}=${v}`))
    }
  } else if (req.body) parts.push('--data', shellQuote(req.body))
  parts.push(shellQuote(req.url))
  return parts.join(' ')
}
