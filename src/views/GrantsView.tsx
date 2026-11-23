import { ExternalLink, KeyRound, MonitorSmartphone, Repeat, Square } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HttpExchangeView } from '../components/HttpExchangeView'
import { Alert, Badge, CopyButton, Field, SecretInput, Tabs, cx } from '../components/ui'
import { credentialsFor, machineCredentialsFor, storeGrantTokens } from '../lib/flows'
import { orgTokenEndpoint } from '../lib/oauth/b2b'
import {
  TOKEN_TYPES,
  clientCredentialsGrant,
  nextPollStep,
  pollDeviceToken,
  requestDeviceAuthorization,
  tokenExchangeGrant,
  type ClientCredentials,
  type DeviceAuthorization,
  type GrantResult,
} from '../lib/oauth/client'
import type { HttpExchange } from '../lib/oauth/http'
import type { ClientAuthMethod, GrantKind, Profile, TokenSet } from '../lib/oauth/types'
import { activeProfile, secretsFor, setSecrets, setState, updateProfile, useAppState } from '../lib/store/appStore'

type GrantTab = 'client_credentials' | 'device' | 'token_exchange'

type ClientKind = 'signin' | 'machine'

function ClientCard({ selected, onSelect, title, badge, detail, note, children }: {
  selected: boolean
  onSelect: () => void
  title: string
  badge?: ReactNode
  detail: ReactNode
  note?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={cx('rounded-lg border p-3', selected ? 'border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-500 dark:bg-indigo-950/30' : 'border-zinc-200 dark:border-zinc-800')}>
      <label className="flex cursor-pointer items-center gap-2">
        <input type="radio" className="accent-indigo-600" checked={selected} onChange={onSelect} />
        <span className="font-medium">{title}</span>
        <span className="flex-1" />
        {badge}
      </label>
      <div className="mt-1 pl-6 text-xs text-zinc-500">{detail}</div>
      {note && <div className="mt-1 pl-6 text-xs text-zinc-500">{note}</div>}
      {children}
    </div>
  )
}

/** The client these grants run as: the sign-in client, or the configuration's machine client (a
 * confidential client for grants with no user). The machine client's ID and method are saved with
 * the configuration; its secret stays in memory. */
function ClientPicker({ profile, kind, onKind, tab }: { profile: Profile; kind: ClientKind; onKind: (k: ClientKind) => void; tab: GrantTab }) {
  const secrets = useAppState((s) => secretsFor(profile.id, s))
  const up = (patch: Partial<Profile>) => updateProfile(profile.id, patch)
  const machine = machineCredentialsFor(profile)
  const signInPublic = profile.clientAuthMethod === 'none'
  const machineReady = !!machine.clientId && (machine.method === 'none' || !!machine.clientSecret)
  const problem =
    kind === 'signin'
      ? tab === 'client_credentials' && signInPublic
        ? "The sign-in client is public, and a public client can't use client credentials. Use the machine client."
        : !signInPublic && !secrets.clientSecret
          ? "The sign-in client's secret is empty. Enter it on the Sign in page, or use the machine client."
          : undefined
      : !machine.clientId
        ? "Enter the machine client's ID."
        : machine.method !== 'none' && !machine.clientSecret
          ? "Enter the machine client's secret. It stays in memory for this tab."
          : undefined

  return (
    <section aria-label="Client" className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">Client</h3>
        <span className="text-[13px] text-zinc-500">
          {tab === 'client_credentials' ? 'Client credentials needs a confidential client.' : 'The client these requests are sent as.'}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ClientCard
          selected={kind === 'signin'}
          onSelect={() => onKind('signin')}
          title="Sign-in client"
          badge={<Badge tone={signInPublic ? 'neutral' : 'green'}>{signInPublic ? 'public' : profile.clientAuthMethod}</Badge>}
          detail={<span className="code">{profile.clientId || '(not set)'}</span>}
          note={tab === 'client_credentials' && signInPublic ? "A public client can't use client credentials." : 'Set on the Sign in page.'}
        />
        <ClientCard
          selected={kind === 'machine'}
          onSelect={() => onKind('machine')}
          title={machine.clientId ? 'Machine client' : 'Add a machine client'}
          badge={machine.clientId ? <Badge tone={machineReady ? 'green' : 'amber'}>{machineReady ? (machine.method === 'none' ? 'public' : 'secret entered') : 'needs its secret'}</Badge> : undefined}
          detail={machine.clientId ? <span className="code">{machine.clientId} · {machine.method}</span> : 'A confidential client for grants with no user.'}
          note="Saved with this configuration. The secret stays in memory for this tab."
        />
      </div>
      {kind === 'machine' && (
        <div className="grid gap-3 border-t border-zinc-100 pt-3 md:grid-cols-[2fr_1.4fr_2fr] dark:border-zinc-800">
          <Field label="Machine client ID">
            <input className="input code" value={profile.machineClientId} spellCheck={false} placeholder="For example my-app-m2m" onChange={(e) => up({ machineClientId: e.target.value })} />
          </Field>
          <Field label="Authentication">
            <select className="input" value={profile.machineAuthMethod} onChange={(e) => up({ machineAuthMethod: e.target.value as ClientAuthMethod })}>
              <option value="client_secret_post">client_secret_post</option>
              <option value="client_secret_basic">client_secret_basic</option>
              <option value="none">none (public)</option>
            </select>
          </Field>
          {profile.machineAuthMethod !== 'none' && (
            <Field label="Client secret">
              <SecretInput value={secrets.machineClientSecret} onChange={(v) => setSecrets(profile.id, { machineClientSecret: v })} />
            </Field>
          )}
        </div>
      )}
      {problem && <Alert tone="amber">{problem}</Alert>}
    </section>
  )
}

function TokenEndpointPicker({ profile, value, onChange }: { profile: Profile; value: string; onChange: (v: string) => void }) {
  const orgs = profile.b2b.style === 'path' ? profile.b2b.organizations : []
  const options = [{ label: 'Default', url: profile.endpoints.token }, ...orgs.map((o) => ({ label: o.name, url: orgTokenEndpoint(profile, o) }))]
  return (
    <Field label="Token endpoint" hint={orgs.length ? 'Pick an organization to get a token issued in it.' : undefined}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.url + o.label} value={o.url}>
            {o.label}: {o.url || '(not set)'}
          </option>
        ))}
      </select>
    </Field>
  )
}

interface Outcome {
  title: string
  ok: boolean
  detail?: ReactNode
  exchange?: HttpExchange
  set?: TokenSet
}

function OutcomeView({ outcome }: { outcome: Outcome }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={outcome.ok ? 'green' : 'red'}>{outcome.ok ? 'success' : 'failed'}</Badge>
        <h3 className="font-semibold">{outcome.title}</h3>
        {outcome.set && (
          <button type="button" className="btn-ghost text-xs" onClick={() => setState({ view: 'tokens', selectedTokenSetId: outcome.set!.id })}>
            <KeyRound size={13} /> Open in Tokens
          </button>
        )}
      </div>
      {outcome.detail}
      {outcome.exchange && <HttpExchangeView exchange={outcome.exchange} defaultOpen={!outcome.ok} />}
    </div>
  )
}

function grantOutcome(profile: Profile, grant: GrantKind, label: string, g: GrantResult, endpoint: string, creds: ClientCredentials, parentId?: string): Outcome {
  if (g.tokens) {
    const set = storeGrantTokens(profile, grant, label, g.tokens, endpoint, creds, parentId)
    return { title: `${label}: tokens issued`, ok: true, exchange: g.exchange, set }
  }
  return {
    title: `${label}: ${g.error?.error ?? 'failed'}`,
    ok: false,
    exchange: g.exchange,
    detail: g.error?.error_description ? <p className="text-sm">{g.error.error_description}</p> : undefined,
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ---- Client credentials ----

function ClientCredentialsTab({ profile, creds, tokenEndpoint }: { profile: Profile; creds: () => ClientCredentials; tokenEndpoint: string }) {
  const [scope, setScope] = useState('')
  const [resource, setResource] = useState(profile.resources[0] ?? '')
  const [audience, setAudience] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>()
  const [error, setError] = useState<string>()

  async function run() {
    setBusy(true)
    setError(undefined)
    try {
      const c = creds()
      const g = await clientCredentialsGrant({ tokenEndpoint, creds: c, scope, resource, audience, extraParams: profile.extraTokenParams })
      setOutcome(grantOutcome(profile, 'client_credentials', 'Client credentials', g, tokenEndpoint, c))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        RFC 6749 §4.4. The client gets a token for itself, with no user. It needs a confidential client, so its secret is sent from this browser: use a test client.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Scope" hint="Optional. Space separated.">
          <input className="input code" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="api:read" />
        </Field>
        <Field label="Resource (RFC 8707)" hint="Optional.">
          <input className="input code" value={resource} onChange={(e) => setResource(e.target.value)} placeholder="https://api.example.com" />
        </Field>
        <Field label="Audience" hint="Optional; some servers use it instead of resource.">
          <input className="input code" value={audience} onChange={(e) => setAudience(e.target.value)} />
        </Field>
      </div>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void run()}>
        Request token
      </button>
      {error && <Alert tone="red">{error}</Alert>}
      {outcome && <OutcomeView outcome={outcome} />}
    </div>
  )
}

// ---- Device authorization ----

interface DeviceState {
  auth: DeviceAuthorization
  startedAt: number
  interval: number
  polls: number
  status: 'polling' | 'done' | 'stopped'
  message?: string
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function DeviceTab({ profile, creds, tokenEndpoint }: { profile: Profile; creds: () => ClientCredentials; tokenEndpoint: string }) {
  const [scope, setScope] = useState(profile.scope)
  const [resource, setResource] = useState(profile.resources[0] ?? '')
  const [device, setDevice] = useState<DeviceState>()
  const [outcome, setOutcome] = useState<Outcome>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const run = useRef(0)
  const now = useNow(device?.status === 'polling')

  // Stop polling when the view goes away.
  useEffect(() => () => void (run.current += 1), [])

  async function start() {
    const id = ++run.current
    setBusy(true)
    setError(undefined)
    setOutcome(undefined)
    setDevice(undefined)
    let c: ClientCredentials
    try {
      c = creds()
      const r = await requestDeviceAuthorization({ endpoint: profile.endpoints.deviceAuthorization, creds: c, scope, resource, extraParams: profile.extraTokenParams })
      if (!r.authorization) {
        setOutcome({
          title: `Device authorization: ${r.error?.error ?? 'failed'}`,
          ok: false,
          exchange: r.exchange,
          detail: r.error?.error_description ? <p className="text-sm">{r.error.error_description}</p> : undefined,
        })
        return
      }
      const auth = r.authorization
      let state: DeviceState = { auth, startedAt: Date.now(), interval: Math.max(1, auth.interval ?? 5), polls: 0, status: 'polling' }
      setDevice(state)
      setBusy(false)
      const deadline = state.startedAt + auth.expires_in * 1000
      for (;;) {
        await new Promise((res) => setTimeout(res, state.interval * 1000))
        if (run.current !== id) return
        if (Date.now() > deadline) {
          state = { ...state, status: 'stopped', message: 'The device code expired before the user approved it.' }
          setDevice(state)
          return
        }
        const g = await pollDeviceToken(tokenEndpoint, c, auth.device_code, profile.extraTokenParams)
        if (run.current !== id) return
        const step = nextPollStep(g, state.interval)
        state = { ...state, polls: state.polls + 1 }
        if (step.kind === 'wait') {
          state = { ...state, interval: step.interval, message: g.error?.error === 'slow_down' ? `Server asked to slow down: polling every ${step.interval}s.` : undefined }
          setDevice(state)
          continue
        }
        if (step.kind === 'done') {
          setDevice({ ...state, status: 'done' })
          setOutcome(grantOutcome(profile, 'device_code', 'Device authorization', g, tokenEndpoint, c))
        } else {
          setDevice({ ...state, status: 'stopped', message: step.reason })
          setOutcome(grantOutcome(profile, 'device_code', 'Device authorization', g, tokenEndpoint, c))
        }
        return
      }
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    run.current += 1
    setDevice((d) => (d ? { ...d, status: 'stopped', message: 'Stopped polling.' } : d))
  }

  const remaining = device ? Math.max(0, Math.round((device.startedAt + device.auth.expires_in * 1000 - Math.max(now, device.startedAt)) / 1000)) : 0
  const openUrl = device?.auth.verification_uri_complete ?? device?.auth.verification_uri

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        RFC 8628. For devices without a browser: the device shows a code, the user approves it on another screen, and the device polls the token endpoint until then. Here this tab plays the device.
      </p>
      {!profile.endpoints.deviceAuthorization && (
        <Alert tone="blue">Set the device authorization endpoint in the configuration. Discovery fills it when the server advertises the grant.</Alert>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Scope">
          <input className="input code" value={scope} onChange={(e) => setScope(e.target.value)} />
        </Field>
        <Field label="Resource (RFC 8707)" hint="Optional.">
          <input className="input code" value={resource} onChange={(e) => setResource(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={busy || device?.status === 'polling'} onClick={() => void start()}>
          <MonitorSmartphone size={15} /> Start device sign-in
        </button>
        {device?.status === 'polling' && (
          <button type="button" className="btn-ghost" onClick={cancel}>
            <Square size={13} /> Stop polling
          </button>
        )}
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      {device && (
        <div className="grid gap-4 rounded-lg border border-zinc-200 p-4 md:grid-cols-[auto_1fr] dark:border-zinc-800">
          <div className="text-center">
            <div className="label">User code</div>
            <div className="code flex items-center justify-center gap-1 text-3xl font-bold tracking-[0.2em]">
              {device.auth.user_code}
              <CopyButton value={device.auth.user_code} />
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              Go to{' '}
              <a className="code text-indigo-600 underline dark:text-indigo-400" href={device.auth.verification_uri} target="_blank" rel="noreferrer noopener">
                {device.auth.verification_uri}
              </a>{' '}
              and enter the code
              {device.auth.verification_uri_complete ? ', or open the link that carries it:' : '.'}
            </div>
            {openUrl && (
              <a className="btn-secondary inline-flex" href={openUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink size={14} /> Open verification page
              </a>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              {device.status === 'polling' && <Badge tone="blue">waiting for approval</Badge>}
              {device.status === 'done' && <Badge tone="green">approved</Badge>}
              {device.status === 'stopped' && <Badge tone="amber">stopped</Badge>}
              <span>
                {device.polls} poll{device.polls === 1 ? '' : 's'}, every {device.interval}s
              </span>
              {device.status === 'polling' && <span>· code expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span>}
            </div>
            {device.message && <div className="text-xs">{device.message}</div>}
          </div>
        </div>
      )}
      {outcome && <OutcomeView outcome={outcome} />}
    </div>
  )
}

// ---- Token exchange ----

const TYPE_OPTIONS: [string, string][] = [
  [TOKEN_TYPES.access_token, 'access_token'],
  [TOKEN_TYPES.refresh_token, 'refresh_token'],
  [TOKEN_TYPES.id_token, 'id_token'],
  [TOKEN_TYPES.jwt, 'jwt'],
  [TOKEN_TYPES.saml2, 'saml2'],
  [TOKEN_TYPES.id_jag, 'id-jag'],
]

interface TokenSource {
  key: string
  label: string
  value: string
  type: string
}

/** Every string token in the stored sets, with the RFC 8693 type its field suggests. */
function tokenSources(sets: TokenSet[], profile: Profile): TokenSource[] {
  const typeOf = (field: string) => {
    if (field === 'access_token') return TOKEN_TYPES.access_token
    if (field === 'refresh_token') return TOKEN_TYPES.refresh_token
    if (field === 'id_token') return TOKEN_TYPES.id_token
    if (field === profile.b2b.switchExchange.subjectTokenField) return profile.b2b.switchExchange.subjectTokenType
    return TOKEN_TYPES.jwt
  }
  const out: TokenSource[] = []
  for (const s of sets)
    for (const [field, v] of Object.entries(s.response))
      if (typeof v === 'string' && v.length > 20 && (field.endsWith('_token') || field.endsWith('_secret')))
        out.push({ key: `${s.id}:${field}`, label: `${s.label} · ${field}`, value: v, type: typeOf(field) })
  return out
}

function TokenInput({ label, sources, optional, token, onChange }: {
  label: string
  sources: TokenSource[]
  optional?: boolean
  token: { source: string; value: string; type: string }
  onChange: (t: { source: string; value: string; type: string }) => void
}) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-sm font-medium">{label}</div>
      <div className="grid gap-2 md:grid-cols-[1fr_220px]">
        <select
          className="input"
          value={token.source}
          onChange={(e) => {
            const src = sources.find((s) => s.key === e.target.value)
            if (src) onChange({ source: src.key, value: src.value, type: src.type })
            else onChange({ source: e.target.value, value: e.target.value === 'none' ? '' : token.value, type: e.target.value === 'none' ? '' : token.type || TOKEN_TYPES.access_token })
          }}
        >
          {optional && <option value="none">None</option>}
          <option value="paste">Paste a token</option>
          {sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select className="input code text-xs" value={token.type} disabled={token.source === 'none'} onChange={(e) => onChange({ ...token, type: e.target.value })}>
          {token.source === 'none' && <option value="">—</option>}
          {TYPE_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {token.source === 'paste' && (
        <textarea className="input code h-20 text-xs" placeholder="token" value={token.value} onChange={(e) => onChange({ ...token, value: e.target.value })} spellCheck={false} />
      )}
      {token.source !== 'paste' && token.source !== 'none' && <div className="code truncate text-xs text-zinc-500">{token.value}</div>}
    </div>
  )
}

function TokenExchangeTab({ profile, creds, tokenEndpoint }: { profile: Profile; creds: () => ClientCredentials; tokenEndpoint: string }) {
  const sets = useAppState((s) => s.tokenSets)
  const sources = tokenSources(sets, profile)
  const first = sources.find((s) => s.key.endsWith(':access_token'))
  const [picked, setSubject] = useState<{ source: string; value: string; type: string }>()
  // Until the user picks one, follow the newest access token (tokens may arrive after this tab opened).
  const subject = picked ?? (first ? { source: first.key, value: first.value, type: first.type } : { source: 'paste', value: '', type: TOKEN_TYPES.access_token })
  const [actor, setActor] = useState({ source: 'none', value: '', type: '' })
  const [requested, setRequested] = useState('')
  const [audience, setAudience] = useState('')
  const [resource, setResource] = useState('')
  const [scope, setScope] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>()
  const [error, setError] = useState<string>()

  async function run() {
    setBusy(true)
    setError(undefined)
    try {
      const c = creds()
      const g = await tokenExchangeGrant({
        tokenEndpoint,
        creds: c,
        subjectToken: subject.value,
        subjectTokenType: subject.type,
        actorToken: actor.source === 'none' ? undefined : actor.value,
        actorTokenType: actor.source === 'none' ? undefined : actor.type,
        requestedTokenType: requested,
        audience,
        resource,
        scope,
        extraParams: profile.extraTokenParams,
      })
      const parentId = subject.source.includes(':') ? subject.source.split(':')[0] : undefined
      const o = grantOutcome(profile, 'token_exchange', 'Token exchange', g, tokenEndpoint, c, parentId)
      if (g.tokens?.issued_token_type)
        o.detail = (
          <p className="text-sm">
            issued_token_type <span className="code">{g.tokens.issued_token_type}</span>
          </p>
        )
      setOutcome(o)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        RFC 8693. Trade a token for another one: a different audience or scope, a downscoped token, a token for another organization, or delegation with an actor token.
      </p>
      <TokenInput label="Subject token" sources={sources} token={subject} onChange={setSubject} />
      <TokenInput label="Actor token (delegation, optional)" sources={sources} optional token={actor} onChange={setActor} />
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Requested token type" hint="Optional.">
          <select className="input code text-xs" value={requested} onChange={(e) => setRequested(e.target.value)}>
            <option value="">(server default)</option>
            {TYPE_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Scope" hint="Optional.">
          <input className="input code" value={scope} onChange={(e) => setScope(e.target.value)} />
        </Field>
        <Field label="Audience" hint="Optional: logical name of the target service.">
          <input className="input code" value={audience} onChange={(e) => setAudience(e.target.value)} />
        </Field>
        <Field label="Resource" hint="Optional: URI of the target service.">
          <input className="input code" value={resource} onChange={(e) => setResource(e.target.value)} />
        </Field>
      </div>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void run()}>
        <Repeat size={15} /> Exchange
      </button>
      {error && <Alert tone="red">{error}</Alert>}
      {outcome && <OutcomeView outcome={outcome} />}
    </div>
  )
}

export function GrantsView() {
  const profile = useAppState((s) => activeProfile(s))
  const [tab, setTab] = useState<GrantTab>('client_credentials')
  // Each grant remembers the client chosen for it. Client credentials starts on the machine client
  // when the sign-in client is public, since a public client cannot use it.
  const [picked, setPicked] = useState<Partial<Record<GrantTab, ClientKind>>>({})
  const kindFor = (t: GrantTab): ClientKind => picked[t] ?? (t === 'client_credentials' && profile.clientAuthMethod === 'none' ? 'machine' : 'signin')
  const kind = kindFor(tab)
  const [endpoint, setEndpoint] = useState(profile.endpoints.token)
  // Follow the configuration when it changes (another profile, discovery).
  const known = [profile.endpoints.token, ...(profile.b2b.style === 'path' ? profile.b2b.organizations.map((o) => orgTokenEndpoint(profile, o)) : [])]
  const tokenEndpoint = known.includes(endpoint) ? endpoint : profile.endpoints.token
  const credsFor = (t: GrantTab) => () => (kindFor(t) === 'machine' ? machineCredentialsFor(profile) : credentialsFor(profile))
  const props = { profile, tokenEndpoint }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Other grants</h2>
        <p className="text-sm text-zinc-500">Grants that need no redirect. Tokens they return are added to the Tokens list, where every operation works on them.</p>
      </div>
      <Tabs
        tabs={[
          { id: 'client_credentials', label: 'Client credentials' },
          { id: 'device', label: 'Device authorization' },
          { id: 'token_exchange', label: 'Token exchange' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <ClientPicker profile={profile} kind={kind} onKind={(k) => setPicked({ ...picked, [tab]: k })} tab={tab} />
      <TokenEndpointPicker profile={profile} value={tokenEndpoint} onChange={setEndpoint} />
      {/* Kept mounted so device polling and form input survive tab switches. */}
      <div hidden={tab !== 'client_credentials'}>
        <ClientCredentialsTab {...props} creds={credsFor('client_credentials')} />
      </div>
      <div hidden={tab !== 'device'}>
        <DeviceTab {...props} creds={credsFor('device')} />
      </div>
      <div hidden={tab !== 'token_exchange'}>
        <TokenExchangeTab {...props} creds={credsFor('token_exchange')} />
      </div>
    </div>
  )
}
