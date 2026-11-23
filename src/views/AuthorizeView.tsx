import { ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, RotateCcw, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HttpExchangeView } from '../components/HttpExchangeView'
import { SignInResult } from '../components/SignIns'
import { Alert, CopyButton, SecretInput, cx } from '../components/ui'
import { ERROR_HINTS } from '../lib/errors'
import { prepareAuthorization, pushAuthorization, runDiscovery, startSignIn } from '../lib/flows'
import { PRESETS, presetById, serverPatch } from '../lib/oauth/presets'
import { carryDraft, jsonToParams, paramsToJson, withParams, type AuthorizationRequest, type ParResult, type PendingAuthorization } from '../lib/oauth/authorize'
import type { Organization, Profile } from '../lib/oauth/types'
import { displayUrl, isHttpUrl } from '../lib/oauth/url'
import { ClientPicker } from '../components/Clients'
import { activeProfile, clientSecretOf, setClientSecret, updateProfile, useAppState } from '../lib/store/appStore'
import { MoreSettings, ScopeChips } from './ConfigPanel'

/** Seconds until a pushed request expires, ticking once a second from the moment of the push. */
function useCountdown(window: { pushedAt: number; expiresAt: number } | undefined): number | undefined {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!window) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [window])
  return window ? Math.max(0, Math.round((window.expiresAt - Math.max(now, window.pushedAt)) / 1000)) : undefined
}

export function profileProblems(profile: Profile): string[] {
  const p: string[] = []
  if (!profile.endpoints.authorization) p.push('Set the authorization endpoint (run discovery).')
  else if (!isHttpUrl(profile.endpoints.authorization)) p.push('The authorization endpoint is not an absolute http(s) URL.')
  if (!profile.endpoints.token) p.push('Set the token endpoint (run discovery).')
  else if (!isHttpUrl(profile.endpoints.token)) p.push('The token endpoint is not an absolute http(s) URL.')
  if (!profile.clientId) p.push('Set the client ID.')
  if (!profile.redirectUri) p.push('Set the redirect URI.')
  return p
}

/** Opens the sign-in in its own tab, so this tab keeps its state and several sign-ins can run at once.
 * The tab is opened before anything else so the browser treats it as a response to the click. */
function openSignIn(pending: PendingAuthorization): void {
  const tab = window.open('about:blank', '_blank')
  startSignIn(pending)
  if (!tab) {
    // Pop-ups blocked: sign in in this tab; the callback page brings the response back here.
    window.location.assign(pending.authorizationUrl)
    return
  }
  // The sign-in page gets no handle on this tab.
  tab.opener = null
  tab.location.href = pending.authorizationUrl
}

/** The authorization request as editable JSON, with the PAR step and sign-in. */
export function RequestPreview({ profile, org, overrides, label, startLabel, showEditor = true }: {
  profile: Profile
  org?: Organization
  overrides?: [string, string][]
  label?: string
  startLabel?: string
  /** Off: the request is sent as generated, without the JSON editor on screen. */
  showEditor?: boolean
}) {
  const [req, setReq] = useState<AuthorizationRequest>()
  const current = useRef<AuthorizationRequest | undefined>(undefined)
  const [error, setError] = useState<string>()
  const [draft, setDraft] = useState<string>()
  const [view, setView] = useState<'json' | 'url'>('json')
  const [pushing, setPushing] = useState(false)
  const [par, setPar] = useState<{ result: ParResult; pending?: PendingAuthorization }>()
  // Settings that do not change the request (name, timestamps, the two step toggles) must not
  // regenerate it: that would throw away edits and a request already pushed with PAR.
  const { updatedAt: _u, name: _n, usePar: _p, redeemCodeAutomatically: _r, ...requestFields } = profile
  const key = JSON.stringify([requestFields, org, overrides])
  const remaining = useCountdown(par?.pending?.par)

  /** New state, nonce and verifier. Edits are kept: generated values left as they were follow along. */
  const regenerate = useCallback(() => {
    setPar(undefined)
    prepareAuthorization(profile, org, { overrides, label })
      .then((r) => {
        const before = current.current
        current.current = r
        setReq(r)
        setDraft((d) => (d && before ? carryDraft(d, before.params, r.params) : d))
        setError(undefined)
      })
      .catch((e: unknown) => {
        current.current = undefined
        setReq(undefined)
        setError(e instanceof Error ? e.message : String(e))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    // A changed setting rebuilds the request from the configuration.
    setDraft(undefined)
    regenerate()
  }, [regenerate])

  const edited = useMemo((): { req?: AuthorizationRequest; error?: string } => {
    if (!req) return {}
    if (draft === undefined) return { req }
    try {
      return { req: withParams(req, jsonToParams(draft)) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [req, draft])

  if (error) return <Alert tone="amber">{error}</Alert>
  if (!req) return null
  const effective = edited.req
  const usePar = profile.usePar
  const target = usePar ? par?.pending : effective?.pending
  const expired = remaining === 0
  const parErr = par?.result.error?.error
  const text = draft ?? paramsToJson(req.params)
  const rows = Math.max(6, text.split('\n').length + 1)

  const push = async () => {
    if (!effective) return
    setPushing(true)
    try {
      setPar(await pushAuthorization(effective))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPushing(false)
    }
  }

  const signIn = () => {
    if (!target) return
    openSignIn(target)
    // The values are single use: the next sign-in gets new ones.
    regenerate()
  }

  return (
    <div className="space-y-3">
      {showEditor && (
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-3.5 py-2.5 dark:border-zinc-800">
          <span className="font-semibold">Authorization request</span>
          <span className="code text-zinc-500">GET {displayUrl(req.pending.authorizationEndpoint)}</span>
          <span className="flex-1" />
          <div role="tablist" aria-label="Request view" className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {(['json', 'url'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cx('h-7 rounded-md px-3 text-[13px] font-medium', view === v ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100' : 'text-zinc-500')}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {view === 'json' ? (
          <textarea
            className="code block w-full resize-y bg-white px-4 py-3 text-[13px] leading-[22px] text-zinc-900 outline-none focus:bg-indigo-50/30 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:bg-indigo-950/20"
            value={text}
            rows={rows}
            spellCheck={false}
            aria-label="Authorization request parameters (JSON)"
            onChange={(e) => setDraft(e.target.value)}
          />
        ) : (
          <div className="space-y-3 px-4 py-3">
            {effective ? (
              <div className="flex items-start gap-1">
                <code className="code flex-1 break-all">{effective.url}</code>
                <CopyButton value={effective.url} onCopy={() => startSignIn(effective.pending)} />
              </div>
            ) : (
              <p className="text-sm text-zinc-500">Fix the JSON to see the URL.</p>
            )}
            <div>
              <span className="label">code_verifier (stays in this tab until the code exchange)</span>
              <code className="code break-all">{req.pending.codeVerifier}</code>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-zinc-50/70 px-3.5 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
          {edited.error ? (
            <span className="text-red-700 dark:text-red-400">{edited.error}</span>
          ) : (
            <span>state, nonce and code_challenge are generated, and change after each sign-in. Edit, add or remove anything else: the JSON is the request.</span>
          )}
          <span className="flex-1" />
          {draft !== undefined && (
            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setDraft(undefined)}>
              <RotateCcw size={12} /> Reset edits
            </button>
          )}
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={regenerate} title="New state, nonce and verifier">
            <RefreshCw size={12} /> Regenerate
          </button>
        </div>
      </section>
      )}

      {usePar && (
        <div className="card space-y-2 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Push the request first (RFC 9126)</span>
            <span className="text-xs text-zinc-500">
              to <span className="code">{profile.endpoints.par ? displayUrl(profile.endpoints.par) : '(no PAR endpoint: set it under More settings)'}</span>
            </span>
          </div>
          {!par?.pending && (
            <button type="button" className="btn-secondary" disabled={pushing || !profile.endpoints.par || !effective} onClick={() => void push()}>
              {pushing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Push request
            </button>
          )}
          {par?.result.error && (
            <Alert tone="red">
              The push failed: {parErr}
              {par.result.error.error_description ? `. ${par.result.error.error_description}` : ''}
              {parErr && ERROR_HINTS[parErr] && <div className="mt-1 text-zinc-600 dark:text-zinc-400">{ERROR_HINTS[parErr]}</div>}
            </Alert>
          )}
          {par?.pending?.par && (
            <div className="space-y-1 text-sm">
              <div>
                <span className="label">request_uri</span>
                <code className="code break-all">{par.pending.par.requestUri}</code>
              </div>
              <div className={expired ? 'text-red-600 dark:text-red-400' : 'text-zinc-500'}>
                {expired ? 'The pushed request has expired. Regenerate and push again.' : `Expires in ${remaining}s. The browser now carries only client_id and request_uri.`}
              </div>
            </div>
          )}
          {par && <HttpExchangeView exchange={par.result.exchange} defaultOpen={!par.pending} />}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary h-10 px-4 font-semibold" disabled={!target || expired} title={usePar && !par?.pending ? 'Push the request first' : undefined} onClick={signIn}>
          <ExternalLink size={16} /> {startLabel ?? 'Send request'}
        </button>
        {target && !expired && (
          <CopyButton value={target.authorizationUrl} label="Copy URL" className="h-10 border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900" onCopy={() => { startSignIn(target); regenerate() }} />
        )}
        <span className="text-[13px] text-zinc-500">
          Opens a new tab; the response comes back here{profile.redeemCodeAutomatically ? ' and the code is redeemed at once.' : ', and you decide what to do with the code.'}
        </span>
      </div>
    </div>
  )
}

const DEFAULT_NAMES = ['My first configuration', 'New configuration']

/** Runs discovery when the base URL is left with a new value, and says what it found. */
function useDiscovery(profile: Profile) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'green' | 'amber' | 'red'; text: string }>()
  const tried = useRef<string | undefined>(undefined)
  const preset = presetById(profile.preset)

  const run = async (force = false) => {
    const issuer = profile.issuer.trim()
    if (!isHttpUrl(issuer) || (!force && tried.current === issuer)) return
    tried.current = issuer
    if (DEFAULT_NAMES.includes(profile.name)) updateProfile(profile.id, { name: `${preset.id === 'generic' ? 'Server' : preset.name} · ${displayUrl(issuer).replace(/\/+$/, '')}` })
    setBusy(true)
    setMsg(undefined)
    try {
      const r = await runDiscovery(profile)
      if (r.error)
        setMsg(
          preset.endpointPaths
            ? { tone: 'amber', text: `No discovery document (${r.error}). Using the usual ${preset.name} endpoints.` }
            : { tone: 'red', text: `No discovery document (${r.error}). Choose the server type, or enter the endpoints under More settings.` },
        )
      else setMsg({ tone: r.warnings.length ? 'amber' : 'green', text: r.warnings.length ? r.warnings.join(' ') : 'Endpoints loaded from discovery.' })
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }
  return { busy, msg, run }
}

const TONE = { green: 'text-emerald-700 dark:text-emerald-400', amber: 'text-amber-700 dark:text-amber-400', red: 'text-red-700 dark:text-red-400' }

function Check({ on, onChange, children, title }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode; title?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700 select-none dark:text-zinc-300" title={title}>
      <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

/** The sign-in page: one form, one button, and the result below. */
export function AuthorizeView() {
  const profile = useAppState((s) => activeProfile(s))
  const secret = useAppState((s) => clientSecretOf(profile.id, profile.signInClient, s))
  const [orgId, setOrgId] = useState('')
  const [more, setMore] = useState(false)
  // Bumped by Manage clients: remounts More settings with the Clients card open.
  const [manage, setManage] = useState(0)
  const manageClients = () => {
    setMore(true)
    setManage((n) => n + 1)
  }
  const [json, setJson] = useState(false)
  const org = profile.b2b.organizations.find((o) => o.id === orgId)
  const problems = profileProblems(profile)
  const preset = presetById(profile.preset)
  const discovery = useDiscovery(profile)
  const up = (patch: Partial<Profile>) => updateProfile(profile.id, patch)
  const needsSecret = profile.clientAuthMethod !== 'none'

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <section aria-label="Sign-in request" className="card space-y-4 p-4 sm:p-5">
        <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
          <div>
            <label htmlFor="f-issuer" className="label">
              Server base URL
            </label>
            <div className="flex gap-1.5">
              <select
                aria-label="Server type"
                className="input w-32 shrink-0"
                value={preset.id}
                onChange={(e) => {
                  const next = presetById(e.target.value)
                  up({ ...serverPatch(profile, { preset: next.id }), b2b: { ...next.b2b(), organizations: profile.b2b.organizations } })
                }}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === 'generic' ? 'Any server' : p.name}
                  </option>
                ))}
              </select>
              <input
                id="f-issuer"
                className={cx('input code', !profile.issuer && 'border-indigo-400 ring-2 ring-indigo-500/20')}
                value={profile.issuer}
                placeholder={preset.issuerPlaceholder}
                spellCheck={false}
                autoFocus={!profile.issuer}
                onChange={(e) => up(serverPatch(profile, { issuer: e.target.value }))}
                onBlur={() => void discovery.run()}
                onKeyDown={(e) => e.key === 'Enter' && void discovery.run(true)}
              />
            </div>
            <div className="mt-1 flex min-h-4 items-center gap-1.5 text-[11px] text-zinc-500">
              {discovery.busy ? (
                <>
                  <Loader2 size={11} className="animate-spin" /> Reading the discovery document…
                </>
              ) : discovery.msg ? (
                <span className={TONE[discovery.msg.tone]}>{discovery.msg.text}</span>
              ) : (
                <span>{preset.issuerHint}</span>
              )}
              {!discovery.busy && isHttpUrl(profile.issuer) && (
                <button type="button" className="ml-auto shrink-0 text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => void discovery.run(true)}>
                  Discover again
                </button>
              )}
            </div>
          </div>
          <ClientPicker profile={profile} onManage={manageClients} />
          <div>
            <label htmlFor="f-scope" className="label">
              Scope
            </label>
            <input id="f-scope" className="input code" value={profile.scope} spellCheck={false} onChange={(e) => up({ scope: e.target.value })} />
            <div className="mt-1.5">
              <ScopeChips profile={profile} />
            </div>
          </div>
          <div>
            <span className="label">Redirect URI (register this on the client)</span>
            <div className="flex items-center gap-1.5">
              <code className="code input flex items-center truncate bg-zinc-50 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">{profile.redirectUri}</code>
              <CopyButton value={profile.redirectUri} label="Copy" className="h-9 shrink-0 border border-zinc-200 dark:border-zinc-700" />
            </div>
          </div>
          {needsSecret && (
            <label className="block md:col-span-2">
              <span className="label">Client secret ({profile.clientAuthMethod}; kept in memory for this tab only)</span>
              <SecretInput value={secret} onChange={(v) => setClientSecret(profile.id, profile.signInClient, v)} />
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <Check on={profile.useNonce} onChange={(v) => up({ useNonce: v })} title="OpenID Connect: a random value the ID token must echo">
            Nonce
          </Check>
          <Check on={profile.usePar} onChange={(v) => up({ usePar: v })} title={profile.endpoints.par ? 'RFC 9126: send the parameters in a back-channel POST, then redirect with a request_uri.' : 'The server advertises no PAR endpoint. Set one under More settings.'}>
            Push first (PAR)
          </Check>
          <Check on={profile.redeemCodeAutomatically} onChange={(v) => up({ redeemCodeAutomatically: v })} title="Off: the code waits until you choose Get tokens.">
            Get tokens right away
          </Check>
          {profile.b2b.organizations.length > 0 && (
            <label className="inline-flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
              Organization
              <select className="input h-8 w-auto py-0" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                <option value="">none</option>
                {profile.b2b.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="flex-1" />
          <button type="button" className="btn-ghost px-2 py-1 text-[13px] text-indigo-700 dark:text-indigo-300" aria-expanded={more} onClick={() => setMore(!more)}>
            More settings {more ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <button type="button" className={cx('btn-ghost px-2 py-1 text-[13px] text-indigo-700 dark:text-indigo-300', json && 'bg-indigo-50 dark:bg-indigo-950')} aria-pressed={json} onClick={() => setJson(!json)}>
            Edit as JSON
          </button>
        </div>

        {more && (
          <div className="rounded-xl bg-zinc-100/80 p-3 dark:bg-zinc-950/70">
            <MoreSettings key={manage} openClients={manage > 0} />
          </div>
        )}

        {problems.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary h-10 px-4 font-semibold" disabled>
              <ExternalLink size={16} /> Send request
            </button>
            <span className="text-[13px] text-zinc-500">{!profile.issuer ? 'Enter the server base URL to start.' : problems[0]}</span>
          </div>
        ) : (
          <>
            {needsSecret && !secret && <p className="text-[13px] text-amber-700 dark:text-amber-400">The client secret is empty: the token request will fail until you enter it.</p>}
            <RequestPreview profile={profile} org={org} showEditor={json} />
          </>
        )}
      </section>

      <SignInResult />
    </div>
  )
}
