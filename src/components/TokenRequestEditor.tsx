import { ArrowLeft, Eye, EyeOff, Loader2, Plus, RotateCcw, Send, X } from 'lucide-react'
import { useState } from 'react'
import { ERROR_HINTS } from '../lib/errors'
import { draftCurl, redeemCode, tokenRequestDraft, type RedeemOutcome, type TokenRequestDraft } from '../lib/flows'
import type { ReceivedCode } from '../lib/oauth/authorize'
import { encodeForm, SENSITIVE_FIELDS } from '../lib/oauth/http'
import { setState, useAppState } from '../lib/store/appStore'
import { Alert, Badge, CopyButton, JsonView, Tabs, cx, statusTone } from './ui'

interface Row {
  id: number
  on: boolean
  name: string
  value: string
}

let rowId = 0
const toRows = (pairs: [string, string][]): Row[] => pairs.map(([name, value]) => ({ id: ++rowId, on: true, name, value }))
const fromRows = (rows: Row[]): [string, string][] => rows.filter((r) => r.on && r.name.trim()).map((r) => [r.name.trim(), r.value])

function isSecret(name: string): boolean {
  const n = name.trim().toLowerCase()
  return n === 'authorization' || n === 'client_secret' || SENSITIVE_FIELDS.includes(n)
}

function RowsEditor({ rows, onChange, reveal, addLabel }: { rows: Row[]; onChange: (rows: Row[]) => void; reveal: boolean; addLabel: string }) {
  const set = (id: number, patch: Partial<Row>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1.5rem_minmax(0,2fr)_minmax(0,5fr)_2rem] gap-2 text-xs font-medium text-zinc-500">
        <span />
        <span>Name</span>
        <span>Value</span>
        <span />
      </div>
      {rows.map((r) => (
        <div key={r.id} className={cx('grid grid-cols-[1.5rem_minmax(0,2fr)_minmax(0,5fr)_2rem] items-center gap-2', !r.on && 'opacity-50')}>
          <input type="checkbox" className="mx-auto" checked={r.on} onChange={(e) => set(r.id, { on: e.target.checked })} aria-label={`Send ${r.name || 'this field'}`} />
          <input className="input code" value={r.name} onChange={(e) => set(r.id, { name: e.target.value })} aria-label="Name" spellCheck={false} />
          <input
            className="input code"
            value={r.value}
            type={isSecret(r.name) && !reveal ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => set(r.id, { value: e.target.value })}
            aria-label={`Value of ${r.name || 'this field'}`}
          />
          <button type="button" className="btn-ghost px-1.5" aria-label={`Remove ${r.name || 'this field'}`} onClick={() => onChange(rows.filter((x) => x.id !== r.id))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="btn mt-1 border border-dashed border-zinc-300 text-[13px] text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" onClick={() => onChange([...rows, { id: ++rowId, on: true, name: '', value: '' }])}>
        <Plus size={14} /> {addLabel}
      </button>
    </div>
  )
}

/** The token request for a received code, shown before it is sent and editable in every part. */
export function TokenRequestEditor({ received }: { received: ReceivedCode }) {
  const reveal = useAppState((s) => s.revealSecrets)
  const [initial] = useState<TokenRequestDraft>(() => tokenRequestDraft(received))
  const [url, setUrl] = useState(initial.url)
  const [body, setBody] = useState(() => toRows(initial.form))
  const [headers, setHeaders] = useState(() => toRows(initial.headers))
  const [tab, setTab] = useState<'body' | 'headers' | 'raw'>('body')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<RedeemOutcome>()
  // The tokens from an earlier send stay reachable after a resend of the spent code fails.
  const [tokenSetId, setTokenSetId] = useState<string>()

  const draft: TokenRequestDraft = { url, form: fromRows(body), headers: fromRows(headers) }
  const reset = () => {
    const d = tokenRequestDraft(received)
    setUrl(d.url)
    setBody(toRows(d.form))
    setHeaders(toRows(d.headers))
  }
  const send = async () => {
    setBusy(true)
    const o = await redeemCode(received, draft)
    setOutcome(o)
    if (o.tokenSet) setTokenSetId(o.tokenSet.id)
    setBusy(false)
  }

  const raw = [
    `POST ${url}`,
    ...draft.headers.map(([k, v]) => `${k}: ${isSecret(k) && !reveal ? '••••••' : v}`),
    'Content-Type: application/x-www-form-urlencoded',
    '',
    encodeForm(draft.form.map(([k, v]) => [k, isSecret(k) && !reveal ? '••••••' : v] as [string, string])),
  ].join('\n')
  const response = outcome?.grant?.exchange.response
  const err = outcome?.grant?.error
  const sentTime = outcome?.grant ? new Date(outcome.grant.exchange.startedAt).toLocaleTimeString() : ''

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px] text-zinc-500">
        <button type="button" className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setState({ openCode: undefined })}>
          <ArrowLeft size={14} /> Back to the request
        </button>
        <span aria-hidden="true">/</span>
        <span>{received.pending.label ?? 'Sign-in'}, code received {new Date(received.receivedAt).toLocaleTimeString()}</span>
      </nav>
      <div>
        <h2 className="text-xl font-semibold">Redeem the code</h2>
        <p className="text-sm text-zinc-500">This is the exact request that will be sent. Change anything, including values the spec says not to, and see what the server says.</p>
      </div>

      <div className="grid items-start gap-4 2xl:grid-cols-2">
        <section aria-label="Token request" className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
            <span className="code rounded-md bg-indigo-50 px-2 py-1.5 font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">POST</span>
            <input className="input code flex-1" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Token endpoint" spellCheck={false} />
            <button type="button" className="btn-primary shrink-0" disabled={busy} onClick={() => void send()}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send
            </button>
          </div>
          <div className="px-3">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'body', label: `Body (${draft.form.length})` },
                { id: 'headers', label: `Headers (${draft.headers.length})` },
                { id: 'raw', label: 'Raw' },
              ]}
            />
          </div>
          <div className="p-3">
            {tab === 'body' && <RowsEditor rows={body} onChange={setBody} reveal={reveal} addLabel="Add field" />}
            {tab === 'headers' && (
              <div className="space-y-2">
                <RowsEditor rows={headers} onChange={setHeaders} reveal={reveal} addLabel="Add header" />
                <p className="text-xs text-zinc-500">Content-Type is always application/x-www-form-urlencoded. A header such as Authorization makes the browser send a CORS preflight first.</p>
              </div>
            )}
            {tab === 'raw' && <pre className="code overflow-x-auto rounded-lg bg-zinc-50 p-3 leading-relaxed whitespace-pre-wrap break-all dark:bg-zinc-950">{raw}</pre>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-zinc-50/60 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
            <CopyButton value={draftCurl(draft)} label="Copy as curl" className="border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900" />
            <button type="button" className="btn-ghost text-[13px]" onClick={() => setState({ revealSecrets: !reveal })} aria-pressed={reveal}>
              {reveal ? <EyeOff size={13} /> : <Eye size={13} />} {reveal ? 'Hide values' : 'Show values'}
            </button>
            <button type="button" className="btn-ghost text-[13px]" onClick={reset}>
              <RotateCcw size={13} /> Reset to generated
            </button>
            <span className="flex-1" />
            <span className="text-xs text-zinc-500">A code is single use: sending it again shows how the server treats a reused code.</span>
          </div>
        </section>

        <section aria-label="Response" className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
            <span className="font-semibold">Response</span>
            {response && (
              <Badge tone={statusTone(response.status)}>
                {response.status} {response.statusText}
              </Badge>
            )}
            {outcome?.grant && <span className="text-xs text-zinc-500">{outcome.grant.exchange.durationMs} ms, sent {sentTime}</span>}
            <span className="flex-1" />
            {tokenSetId && (
              <button type="button" className="btn-ghost px-2 text-[13px] text-indigo-600 dark:text-indigo-400" onClick={() => setState({ view: 'tokens', selectedTokenSetId: tokenSetId, openCode: undefined })}>
                Open in Tokens
              </button>
            )}
          </div>
          <div className="space-y-2 p-3">
            {!outcome && !busy && <p className="text-sm text-zinc-500">Nothing sent yet. Press Send to call the token endpoint.</p>}
            {busy && (
              <p className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 size={14} className="animate-spin" /> Waiting for the server…
              </p>
            )}
            {outcome?.error && <Alert tone="red">{outcome.error}</Alert>}
            {outcome?.grant?.exchange.networkError && <Alert tone="red">{outcome.grant.exchange.networkError}</Alert>}
            {err && (
              <Alert tone="red">
                {err.error}
                {err.error_description ? `: ${err.error_description}` : ''}
                {ERROR_HINTS[err.error] && <div className="mt-1 text-zinc-600 dark:text-zinc-400">{ERROR_HINTS[err.error]}</div>}
              </Alert>
            )}
            {outcome?.tokenSet && <Alert tone="green">Tokens issued and saved. Open them in Tokens to decode, check, refresh or revoke them.</Alert>}
            {response && <JsonView value={response.json ?? response.body} className="max-h-[28rem]" />}
          </div>
        </section>
      </div>
    </div>
  )
}
