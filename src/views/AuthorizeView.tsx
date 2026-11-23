import { ExternalLink, Loader2, RefreshCw, RotateCcw, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HttpExchangeView } from '../components/HttpExchangeView'
import { TokenRequestEditor } from '../components/TokenRequestEditor'
import { Alert, CopyButton, cx } from '../components/ui'
import { ERROR_HINTS } from '../lib/errors'
import { prepareAuthorization, pushAuthorization, startSignIn } from '../lib/flows'
import { carryDraft, jsonToParams, paramsToJson, withParams, type AuthorizationRequest, type ParResult, type PendingAuthorization } from '../lib/oauth/authorize'
import type { Organization, Profile } from '../lib/oauth/types'
import { displayUrl, isHttpUrl } from '../lib/oauth/url'
import { activeProfile, setState, updateProfile, useAppState } from '../lib/store/appStore'

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
export function RequestPreview({ profile, org, overrides, label, startLabel }: {
  profile: Profile
  org?: Organization
  overrides?: [string, string][]
  label?: string
  startLabel?: string
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

      {usePar && (
        <div className="card space-y-2 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Push the request first (RFC 9126)</span>
            <span className="text-xs text-zinc-500">
              to <span className="code">{profile.endpoints.par ? displayUrl(profile.endpoints.par) : '(no PAR endpoint: set it in Server settings)'}</span>
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
          <ExternalLink size={16} /> {startLabel ?? 'Sign in in new tab'}
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

function Chip({ on, onChange, children, title }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode; title?: string }) {
  return (
    <label className={on ? 'chip-on' : 'chip'} title={title}>
      <input type="checkbox" className="accent-indigo-600" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

export function AuthorizeView() {
  const profile = useAppState((s) => activeProfile(s))
  const openCode = useAppState((s) => s.openCode)
  const [orgId, setOrgId] = useState('')
  const org = profile.b2b.organizations.find((o) => o.id === orgId)
  const problems = profileProblems(profile)
  const up = (patch: Partial<Profile>) => updateProfile(profile.id, patch)

  if (openCode) return <TokenRequestEditor key={openCode.id} received={openCode} />

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Sign-in with authorization code</h2>
        <p className="text-sm text-zinc-500">Edit the request, then sign in in a new tab. Each sign-in shows up under Sign-ins, where you decide what happens next.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={profile.pkceMethod === 'S256' ? 'chip-on' : 'chip'} title="Change the PKCE method in Server settings">
          PKCE {profile.pkceMethod}
        </span>
        <Chip on={profile.useNonce} onChange={(v) => up({ useNonce: v })}>
          nonce
        </Chip>
        <Chip on={profile.usePar} onChange={(v) => up({ usePar: v })} title={profile.endpoints.par ? 'RFC 9126: send the parameters in a back-channel POST, then redirect with a request_uri.' : 'The server advertises no PAR endpoint. Set one in Server settings.'}>
          Push first (PAR)
        </Chip>
        <Chip on={profile.redeemCodeAutomatically} onChange={(v) => up({ redeemCodeAutomatically: v })} title="Off: the code waits under Sign-ins until you decide.">
          Redeem code automatically
        </Chip>
        <span className={profile.expectIss ? 'chip-on' : 'chip'} title="RFC 9207: from discovery (authorization_response_iss_parameter_supported)">
          {profile.expectIss ? 'iss required' : 'iss checked when sent'}
        </span>
        {profile.b2b.organizations.length > 0 && (
          <>
            <span className="h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
            <label className="chip pr-1">
              Organization
              <select className="input h-7 w-auto border-0 bg-transparent py-0 text-[13px] dark:bg-transparent" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                <option value="">none</option>
                {profile.b2b.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      {problems.length > 0 ? (
        <Alert tone="blue">
          <ul className="list-inside list-disc">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <button type="button" className="btn-ghost mt-1 px-0 text-indigo-700 dark:text-indigo-300" onClick={() => setState({ settingsOpen: true })}>
            Open Server settings
          </button>
        </Alert>
      ) : (
        <RequestPreview profile={profile} org={org} />
      )}
    </div>
  )
}
