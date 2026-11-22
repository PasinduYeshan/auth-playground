// A fetch wrapper that records every exchange (request and response) so the UI can show exactly what
// went over the wire. Records live in memory only; they are never persisted.

export interface HttpRequestRecord {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export interface HttpResponseRecord {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  json?: unknown
}

export interface HttpExchange {
  id: string
  label: string
  startedAt: number
  durationMs: number
  request: HttpRequestRecord
  response?: HttpResponseRecord
  /** Set when fetch itself failed (network error, CORS refusal, mixed content, bad certificate). */
  networkError?: string
}

export type ExchangeListener = (exchange: HttpExchange) => void

let listeners: ExchangeListener[] = []
let counter = 0

export function onExchange(listener: ExchangeListener): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

export interface TracedRequest {
  label: string
  method?: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
  /** Form fields, sent as application/x-www-form-urlencoded. */
  form?: Record<string, string | undefined>
}

export const NETWORK_ERROR_HINT =
  'The browser blocked the request or could not reach the server. The usual causes are: the endpoint does not send CORS headers for this origin (add this site to the server\'s allowed origins), an untrusted TLS certificate (open the server URL in a tab once and accept it), or the server is down.'

export function encodeForm(form: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(form)) {
    if (value !== undefined && value !== '') params.append(key, value)
  }
  return params.toString()
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

export async function tracedFetch(req: TracedRequest): Promise<HttpExchange> {
  const method = req.method ?? (req.form ? 'POST' : 'GET')
  const headers: Record<string, string> = { Accept: 'application/json', ...req.headers }
  let body: string | undefined
  if (req.form) {
    body = encodeForm(req.form)
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }
  const exchange: HttpExchange = {
    id: `x${++counter}-${Date.now()}`,
    label: req.label,
    startedAt: Date.now(),
    durationMs: 0,
    request: { method, url: req.url, headers, body },
  }
  const started = performance.now()
  try {
    // credentials: 'omit' keeps the server's own session cookies out of back-channel calls, which is
    // how a real client behaves and avoids needing Access-Control-Allow-Credentials.
    const res = await fetch(req.url, { method, headers, body, credentials: 'omit', cache: 'no-store' })
    const text = await res.text()
    let json: unknown
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    exchange.response = {
      status: res.status,
      statusText: res.statusText,
      headers: headersToObject(res.headers),
      body: text,
      json,
    }
  } catch (err) {
    exchange.networkError = err instanceof Error ? err.message : String(err)
  }
  exchange.durationMs = Math.round(performance.now() - started)
  for (const l of listeners) l(exchange)
  return exchange
}

/** Secret-bearing fields and headers, masked in the UI unless the user reveals them. */
export const SENSITIVE_FIELDS = [
  'client_secret',
  'code',
  'code_verifier',
  'refresh_token',
  'access_token',
  'id_token',
  'token',
  'subject_token',
  'actor_token',
  'client_assertion',
  'assertion',
  'device_code',
  'device_secret',
]

export function maskValue(value: string): string {
  if (value.length <= 12) return '•'.repeat(Math.max(4, value.length))
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}
