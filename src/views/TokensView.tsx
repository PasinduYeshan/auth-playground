import { Building2, KeyRound, LogOut, Plus, RefreshCcw, Search, ShieldOff, Trash2, UserRound } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { HttpExchangeView } from '../components/HttpExchangeView'
import { TokenViewer, relativeTime } from '../components/TokenViewer'
import { Alert, Badge, Empty, Field, JsonView, Tabs, cx } from '../components/ui'
import { credentialsFor, ensureJwks, introspectionCredentialsFor, newTokenSet, refreshTokenSet } from '../lib/flows'
import { organizationOf } from '../lib/oauth/b2b'
import { buildEndSessionUrl, callUserInfo, introspect, revoke, type OperationResult, type TokenTypeHint } from '../lib/oauth/client'
import { randomString } from '../lib/oauth/encoding'
import type { HttpExchange } from '../lib/oauth/http'
import { decodeToken } from '../lib/oauth/jwt'
import type { Profile, TokenSet } from '../lib/oauth/types'
import { activeProfile, addTokenSet, removeTokenSet, setState, updateTokenSet, useAppState } from '../lib/store/appStore'
import { clearTokenSets } from '../lib/store/tokens'

export const LOGOUT_STATE_KEY = 'ap:logout-state'

/** Reads the logout response once: true when the returned state matches the one sent. */
export function takeLogoutResult(): 'ok' | 'mismatch' | undefined {
  const params = new URLSearchParams(window.location.search)
  const returned = params.get('state')
  const sent = sessionStorage.getItem(LOGOUT_STATE_KEY)
  if (!returned || !sent) return undefined
  sessionStorage.removeItem(LOGOUT_STATE_KEY)
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
  return returned === sent ? 'ok' : 'mismatch'
}

type TokenKey = 'access_token' | 'id_token' | 'refresh_token'

function expiryOf(set: TokenSet): number | undefined {
  const at = set.response.access_token
  if (at) {
    const d = decodeToken(at)
    if (d.kind === 'jwt' && typeof d.payload.exp === 'number') return d.payload.exp
  }
  return set.response.expires_in ? Math.floor(set.obtainedAt / 1000) + set.response.expires_in : undefined
}

export function TokenSetStatus({ set }: { set: TokenSet }) {
  const exp = expiryOf(set)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000)
    return () => clearInterval(t)
  }, [])
  if (set.revoked?.access) return <Badge tone="red">revoked</Badge>
  if (exp && exp * 1000 < Date.now()) return <Badge tone="amber">expired</Badge>
  if (exp) return <Badge tone="green">expires {relativeTime(exp)}</Badge>
  return <Badge>active?</Badge>
}

function TokenSetList({ sets, selectedId }: { sets: TokenSet[]; selectedId?: string }) {
  const byId = new Map(sets.map((s) => [s.id, s]))
  return (
    <div className="space-y-1.5">
      {sets.map((set) => {
        const org = organizationOf(set)
        return (
          <button
            type="button"
            key={set.id}
            onClick={() => setState({ selectedTokenSetId: set.id })}
            className={cx(
              'w-full rounded-lg border px-3 py-2 text-left transition',
              set.id === selectedId ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40' : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700',
            )}
          >
            <div className="truncate text-sm font-medium">{set.label}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <TokenSetStatus set={set} />
              {org && (
                <Badge tone="violet">
                  <Building2 size={11} /> {org.name}
                </Badge>
              )}
              {set.response.refresh_token && <Badge>refresh</Badge>}
              {typeof set.response.device_secret === 'string' && <Badge tone="blue">device secret</Badge>}
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {new Date(set.obtainedAt).toLocaleTimeString()} · {set.grant.replace(/_/g, ' ')}
              {set.parentId && byId.get(set.parentId) ? ` · from "${byId.get(set.parentId)!.label}"` : ''}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function ManualTokenForm() {
  const profile = useAppState((s) => activeProfile(s))
  const [open, setOpen] = useState(false)
  const [access, setAccess] = useState('')
  const [id, setId] = useState('')
  const [refresh, setRefresh] = useState('')
  if (!open)
    return (
      <button type="button" className="btn-ghost w-full text-xs" onClick={() => setOpen(true)}>
        <Plus size={14} /> Paste a token
      </button>
    )
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <Field label="Access token">
        <textarea className="input code h-16" value={access} onChange={(e) => setAccess(e.target.value.trim())} />
      </Field>
      <Field label="ID token (optional)">
        <textarea className="input code h-12" value={id} onChange={(e) => setId(e.target.value.trim())} />
      </Field>
      <Field label="Refresh token (optional)">
        <textarea className="input code h-12" value={refresh} onChange={(e) => setRefresh(e.target.value.trim())} />
      </Field>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={!access && !id}
          onClick={() => {
            addTokenSet(
              newTokenSet({
                label: 'Pasted tokens',
                grant: 'manual',
                profileId: profile.id,
                response: { access_token: access || undefined, id_token: id || undefined, refresh_token: refresh || undefined },
              }),
            )
            setOpen(false)
            setAccess('')
            setId('')
            setRefresh('')
          }}
        >
          Add
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function ActionCard({ icon, title, description, children }: { icon: ReactNode; title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
      <p className="text-xs text-zinc-500">{description}</p>
      {children}
    </div>
  )
}

type OpResult = { title: string; exchange: HttpExchange; body?: unknown; summary?: ReactNode }

function useOperation() {
  const [busy, setBusy] = useState<string>()
  const [result, setResult] = useState<OpResult>()
  const [error, setError] = useState<string>()
  const run = async (name: string, fn: () => Promise<OpResult | undefined>) => {
    setBusy(name)
    setError(undefined)
    try {
      const r = await fn()
      if (r) setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(undefined)
    }
  }
  return { busy, result, error, run }
}

function introspectionSummary(body: unknown): ReactNode {
  if (!body || typeof body !== 'object') return undefined
  const b = body as Record<string, unknown>
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {b.active ? <Badge tone="green">active</Badge> : <Badge tone="red">inactive</Badge>}
      {typeof b.token_type === 'string' && <Badge>{b.token_type}</Badge>}
      {typeof b.exp === 'number' && <span className="text-xs text-zinc-500">expires {relativeTime(b.exp)}</span>}
      {typeof b.scope === 'string' && <span className="code text-xs">{b.scope}</span>}
    </div>
  )
}

function Operations({ set, profile }: { set: TokenSet; profile: Profile }) {
  const op = useOperation()
  const [scope, setScope] = useState('')
  const [hint, setHint] = useState<TokenTypeHint>('access_token')
  const [userinfoMethod, setUserinfoMethod] = useState<'GET' | 'POST'>('GET')
  const tokenFor = (h: TokenTypeHint) => (h === 'refresh_token' ? set.response.refresh_token : set.response.access_token)
  const hasRefresh = !!set.response.refresh_token

  const opResult = (title: string, r: OperationResult, summary?: ReactNode): OpResult => ({ title, exchange: r.exchange, body: r.body, summary })

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <ActionCard icon={<RefreshCcw size={16} />} title="Refresh" description="refresh_token grant. The new set appears in the list, linked to this one.">
          <input className="input code" placeholder="scope (optional, to narrow)" value={scope} onChange={(e) => setScope(e.target.value)} />
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={!hasRefresh || !!op.busy}
            onClick={() =>
              void op.run('refresh', async () => {
                const g = await refreshTokenSet(set, scope)
                return {
                  title: g.tokens ? 'Refreshed' : `Refresh failed: ${g.error?.error}`,
                  exchange: g.exchange,
                  summary: g.error?.error_description ? <span className="text-sm">{g.error.error_description}</span> : undefined,
                }
              })
            }
          >
            {hasRefresh ? 'Refresh tokens' : 'No refresh token'}
          </button>
        </ActionCard>

        <ActionCard icon={<UserRound size={16} />} title="UserInfo" description="Calls the UserInfo endpoint with the access token as a Bearer header.">
          <select className="input" value={userinfoMethod} onChange={(e) => setUserinfoMethod(e.target.value as 'GET' | 'POST')}>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={!set.response.access_token || !!op.busy}
            onClick={() => void op.run('userinfo', async () => opResult('UserInfo', await callUserInfo(profile.endpoints.userinfo, set.response.access_token!, userinfoMethod)))}
          >
            Call UserInfo
          </button>
        </ActionCard>

        <ActionCard icon={<Search size={16} />} title="Introspect / Revoke" description="RFC 7662 and RFC 7009, authenticated as the client (or the introspection client).">
          <select className="input" value={hint} onChange={(e) => setHint(e.target.value as TokenTypeHint)}>
            <option value="access_token">access token</option>
            <option value="refresh_token" disabled={!hasRefresh}>
              refresh token
            </option>
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              disabled={!tokenFor(hint) || !!op.busy}
              onClick={() =>
                void op.run('introspect', async () => {
                  const r = await introspect(profile.endpoints.introspection, introspectionCredentialsFor(profile), tokenFor(hint)!, hint)
                  return opResult(`Introspection (${hint.replace('_', ' ')})`, r, introspectionSummary(r.body))
                })
              }
            >
              <Search size={14} /> Introspect
            </button>
            <button
              type="button"
              className="btn-danger flex-1"
              disabled={!tokenFor(hint) || !!op.busy}
              onClick={() =>
                void op.run('revoke', async () => {
                  const r = await revoke(profile.endpoints.revocation, credentialsFor(profile), tokenFor(hint)!, hint)
                  if (r.ok) updateTokenSet(set.id, { revoked: { ...set.revoked, [hint === 'refresh_token' ? 'refresh' : 'access']: Date.now() } })
                  // Confirm the outcome: a 200 also answers unknown tokens, so ask introspection.
                  let summary: ReactNode = r.ok ? <Badge tone="green">200: the server accepted the revocation</Badge> : undefined
                  if (r.ok && profile.endpoints.introspection) {
                    const check = await introspect(profile.endpoints.introspection, introspectionCredentialsFor(profile), tokenFor(hint)!, hint)
                    const active = (check.body as Record<string, unknown> | undefined)?.active
                    summary = (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {summary}
                        {active === false ? <Badge tone="green">introspection now: inactive</Badge> : <Badge tone="amber">introspection still says active</Badge>}
                      </div>
                    )
                  }
                  return opResult(`Revocation (${hint.replace('_', ' ')})`, r, summary)
                })
              }
            >
              <ShieldOff size={14} /> Revoke
            </button>
          </div>
        </ActionCard>

        <ActionCard icon={<LogOut size={16} />} title="Logout" description={<>RP-initiated logout at the end_session endpoint, with the ID token as a hint. Register <span className="code">{`${window.location.origin}${import.meta.env.BASE_URL}`}</span> as a post-logout redirect URI.</>}>
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={!profile.endpoints.endSession}
            onClick={() => {
              const state = randomString(16)
              sessionStorage.setItem(LOGOUT_STATE_KEY, state)
              const url = buildEndSessionUrl(profile.endpoints.endSession, {
                idTokenHint: set.response.id_token,
                clientId: profile.clientId,
                postLogoutRedirectUri: `${window.location.origin}${import.meta.env.BASE_URL}`,
                state,
              })
              window.location.assign(url)
            }}
          >
            Sign out at the server
          </button>
        </ActionCard>
      </div>

      {op.error && <Alert tone="red">{op.error}</Alert>}
      {op.result && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{op.result.title}</h3>
            {op.result.summary}
          </div>
          {op.result.body !== undefined && op.result.body !== '' && <JsonView value={op.result.body} className="max-h-80" />}
          <HttpExchangeView exchange={op.result.exchange} />
        </div>
      )}
    </div>
  )
}

function TokenSetDetail({ set }: { set: TokenSet }) {
  const profile = useAppState((s) => s.profiles.find((p) => p.id === set.profileId) ?? activeProfile(s))
  const jwks = useAppState((s) => s.jwks[profile.id])
  const available = (['access_token', 'id_token', 'refresh_token'] as TokenKey[]).filter((k) => set.response[k])
  const [tab, setTab] = useState<TokenKey | 'response' | 'operations'>(available[0] ?? 'response')
  const org = organizationOf(set)

  useEffect(() => {
    void ensureJwks(profile)
  }, [profile])
  useEffect(() => {
    setTab((t) => (t === 'operations' || t === 'response' || set.response[t] ? t : (available[0] ?? 'response')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set.id])

  const labels: Record<TokenKey, string> = { access_token: 'Access token', id_token: 'ID token', refresh_token: 'Refresh token' }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{set.label}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
            <TokenSetStatus set={set} />
            {org && (
              <Badge tone="violet">
                <Building2 size={11} /> {org.name}
              </Badge>
            )}
            {set.response.scope && <span className="code">scope: {set.response.scope}</span>}
            {set.tokenEndpoint && <span className="code">via {new URL(set.tokenEndpoint).pathname}</span>}
          </div>
        </div>
        <button type="button" className="btn-ghost text-xs hover:text-red-600" onClick={() => removeTokenSet(set.id)}>
          <Trash2 size={14} /> Remove
        </button>
      </div>
      <Tabs
        tabs={[
          ...available.map((k) => ({ id: k as TokenKey | 'response' | 'operations', label: labels[k] })),
          { id: 'response', label: 'Token response' },
          { id: 'operations', label: 'Operations' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {(tab === 'access_token' || tab === 'id_token' || tab === 'refresh_token') && set.response[tab] && (
        <TokenViewer
          key={`${set.id}-${tab}`}
          token={set.response[tab]!}
          kind={tab === 'access_token' ? 'access' : tab === 'id_token' ? 'id' : 'refresh'}
          jwks={jwks}
          issuer={profile.issuer || undefined}
          clientId={profile.clientId}
          nonce={set.grant === 'authorization_code' ? set.nonce : undefined}
          accessToken={set.response.access_token}
          code={set.code}
        />
      )}
      {tab === 'response' && <JsonView value={set.response} />}
      {tab === 'operations' && <Operations set={set} profile={profile} />}
    </div>
  )
}

export function TokensView() {
  const sets = useAppState((s) => s.tokenSets)
  const selectedId = useAppState((s) => s.selectedTokenSetId)
  const selected = sets.find((s) => s.id === selectedId) ?? sets[0]
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <KeyRound size={15} /> Token sets
          </h3>
          {sets.length > 0 && (
            <button
              type="button"
              className="btn-ghost px-1.5 py-0.5 text-xs"
              onClick={() => {
                if (confirm('Remove every token set from this tab?')) {
                  clearTokenSets()
                  setState({ tokenSets: [], selectedTokenSetId: undefined })
                }
              }}
            >
              Clear all
            </button>
          )}
        </div>
        <TokenSetList sets={sets} selectedId={selected?.id} />
        <ManualTokenForm />
        <p className="text-[11px] text-zinc-500">Tokens stay in this tab (sessionStorage) and are gone when it closes.</p>
      </div>
      <div className="min-w-0">
        {selected ? (
          <TokenSetDetail key={selected.id} set={selected} />
        ) : (
          <Empty>
            No tokens yet. Start a sign-in from <button type="button" className="text-indigo-600 underline" onClick={() => setState({ view: 'authorize' })}>Authorize</button>, or paste a token.
          </Empty>
        )}
      </div>
    </div>
  )
}
