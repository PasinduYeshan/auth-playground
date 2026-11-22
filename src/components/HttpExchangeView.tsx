import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { maskValue, NETWORK_ERROR_HINT, SENSITIVE_FIELDS, type HttpExchange } from '../lib/oauth/http'
import { useAppState } from '../lib/store/appStore'
import { Badge, CopyButton, JsonView, cx, statusTone } from './ui'

function maskHeaders(headers: Record<string, string>, reveal: boolean): Record<string, string> {
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

function maskForm(body: string, reveal: boolean): [string, string][] {
  return [...new URLSearchParams(body).entries()].map(([k, v]) => [k, !reveal && SENSITIVE_FIELDS.includes(k) ? maskValue(v) : v])
}

function maskJson(value: unknown, reveal: boolean): unknown {
  if (reveal || !value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => maskJson(v, reveal))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_FIELDS.includes(k) && typeof v === 'string' ? maskValue(v) : maskJson(v, reveal)
  return out
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export function toCurl(ex: HttpExchange): string {
  const parts = ['curl', '-i']
  if (ex.request.method !== 'GET') parts.push('-X', ex.request.method)
  for (const [k, v] of Object.entries(ex.request.headers)) parts.push('-H', shellQuote(`${k}: ${v}`))
  if (ex.request.body) parts.push('--data', shellQuote(ex.request.body))
  parts.push(shellQuote(ex.request.url))
  return parts.join(' ')
}

function Headers({ headers }: { headers: Record<string, string> }) {
  return (
    <div className="code space-y-0.5">
      {Object.entries(headers).map(([k, v]) => (
        <div key={k} className="break-all">
          <span className="text-zinc-500">{k}:</span> {v}
        </div>
      ))}
    </div>
  )
}

export function HttpExchangeView({ exchange, defaultOpen = false }: { exchange: HttpExchange; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const reveal = useAppState((s) => s.revealSecrets)
  const res = exchange.response
  const isForm = exchange.request.headers['Content-Type'] === 'application/x-www-form-urlencoded'
  const url = new URL(exchange.request.url)
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 bg-zinc-50 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Badge tone="violet">{exchange.request.method}</Badge>
        <span className="font-medium">{exchange.label}</span>
        <span className="code hidden min-w-0 flex-1 truncate text-zinc-500 sm:block">{url.host + url.pathname}</span>
        <span className="flex-1 sm:hidden" />
        {exchange.networkError ? <Badge tone="red">network error</Badge> : <Badge tone={statusTone(res?.status)}>{res?.status}</Badge>}
        <span className="text-xs text-zinc-500">{exchange.durationMs} ms</span>
      </button>
      {open && (
        <div className="grid gap-px bg-zinc-200 lg:grid-cols-2 dark:bg-zinc-800">
          <div className="space-y-2 bg-white p-3 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Request</h4>
              <CopyButton value={toCurl(exchange)} label="curl" />
            </div>
            <div className="code break-all">
              <span className="font-semibold">{exchange.request.method}</span> {exchange.request.url}
            </div>
            <Headers headers={maskHeaders(exchange.request.headers, reveal)} />
            {exchange.request.body &&
              (isForm ? (
                <table className="code w-full">
                  <tbody>
                    {maskForm(exchange.request.body, reveal).map(([k, v], i) => (
                      <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1 pr-3 align-top text-indigo-600 dark:text-indigo-400">{k}</td>
                        <td className="py-1 break-all">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <JsonView value={exchange.request.body} />
              ))}
          </div>
          <div className="space-y-2 bg-white p-3 dark:bg-zinc-900">
            <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Response</h4>
            {exchange.networkError ? (
              <div className="flex gap-2 text-sm text-red-700 dark:text-red-400">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{exchange.networkError}</div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{NETWORK_ERROR_HINT}</div>
                </div>
              </div>
            ) : (
              res && (
                <>
                  <div className={cx('code font-semibold')}>
                    HTTP {res.status} {res.statusText}
                  </div>
                  <Headers headers={res.headers} />
                  {res.body && <JsonView value={res.json !== undefined ? maskJson(res.json, reveal) : res.body} className="max-h-96" />}
                </>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
