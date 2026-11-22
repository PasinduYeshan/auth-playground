import { ExternalLink, Loader2, RefreshCw, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { HttpExchangeView } from '../components/HttpExchangeView'
import { ReceivedCodeCard } from '../components/ReceivedCodeCard'
import { Alert, Badge, CopyButton } from '../components/ui'
import { ERROR_HINTS } from '../lib/errors'
import { navigateToAuthorization, prepareAuthorization, pushAuthorization, rememberAuthorization } from '../lib/flows'
import type { AuthorizationRequest, ParResult, PendingAuthorization } from '../lib/oauth/authorize'
import type { Organization, Profile } from '../lib/oauth/types'
import { displayUrl, isHttpUrl } from '../lib/oauth/url'
import { activeProfile, updateProfile, useAppState } from '../lib/store/appStore'

const PARAM_DOCS: Record<string, string> = {
  response_type: 'Authorization code flow',
  client_id: 'Your client',
  redirect_uri: 'Where the server sends the response',
  scope: 'Requested permissions',
  state: 'Random, single use: binds the response to this request (CSRF)',
  nonce: 'Random: must come back in the ID token (replay)',
  code_challenge: 'PKCE: derived from a secret verifier kept in this tab',
  code_challenge_method: 'PKCE transform',
  resource: 'Target API (RFC 8707): sets the access token audience',
  prompt: 'Login behaviour',
  max_age: 'Maximum age of the authentication',
  login_hint: 'Pre-fills the user',
  acr_values: 'Requested authentication context',
  ui_locales: 'Preferred UI languages',
  response_mode: 'How the response is returned',
  request_uri: 'Reference to the pushed request (RFC 9126)',
}

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

export function RequestPreview({ profile, org, overrides, label, startLabel }: {
  profile: Profile
  org?: Organization
  overrides?: [string, string][]
  label?: string
  startLabel?: string
}) {
  const [req, setReq] = useState<AuthorizationRequest>()
  const [error, setError] = useState<string>()
  // PAR step: the push result, and the transaction to redirect with once the push succeeded.
  const [pushing, setPushing] = useState(false)
  const [par, setPar] = useState<{ result: ParResult; pending?: PendingAuthorization }>()
  // Settings that do not change the request (name, timestamps, the two step toggles) must not
  // regenerate it: that would throw away a request already pushed with PAR.
  const { updatedAt: _u, name: _n, usePar: _p, redeemCodeAutomatically: _r, ...requestFields } = profile
  const key = JSON.stringify([requestFields, org, overrides])
  const remaining = useCountdown(par?.pending?.par)

  const regenerate = useCallback(() => {
    setPar(undefined)
    prepareAuthorization(profile, org, { overrides, label })
      .then((r) => {
        setReq(r)
        setError(undefined)
      })
      .catch((e: unknown) => {
        setReq(undefined)
        setError(e instanceof Error ? e.message : String(e))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    regenerate()
  }, [regenerate])

  const push = async () => {
    if (!req) return
    setPushing(true)
    try {
      setPar(await pushAuthorization(req))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPushing(false)
    }
  }

  if (error) return <Alert tone="amber">{error}</Alert>
  if (!req) return null
  const usePar = profile.usePar
  const target = usePar ? par?.pending : req.pending
  const expired = remaining === 0
  const parErr = par?.result.error?.error
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <tbody>
            {req.params.map(([k, v], i) => (
              <tr key={i} className="border-t border-zinc-100 align-top first:border-t-0 dark:border-zinc-800">
                <td className="w-48 bg-zinc-50/60 px-3 py-1.5 dark:bg-zinc-900/60">
                  <div className="code font-semibold text-indigo-600 dark:text-indigo-400">{k}</div>
                  {PARAM_DOCS[k] && <div className="text-[11px] text-zinc-500">{PARAM_DOCS[k]}</div>}
                </td>
                <td className="code px-3 py-1.5 break-all">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary className="cursor-pointer text-xs font-medium text-zinc-600 select-none dark:text-zinc-400">PKCE verifier and full URL</summary>
        <div className="mt-2 space-y-2 text-sm">
          <div>
            <span className="label">code_verifier (stays in this tab until the code exchange)</span>
            <code className="code break-all">{req.pending.codeVerifier}</code>
          </div>
          <div>
            <span className="label">Authorization URL</span>
            <div className="flex items-start gap-1">
              <code className="code flex-1 break-all">{req.url}</code>
              <CopyButton value={req.url} onCopy={() => rememberAuthorization(req.pending)} />
            </div>
          </div>
        </div>
      </details>
      {usePar && (
        <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Push the request (RFC 9126)</span>
            <span className="text-xs text-zinc-500">
              to <span className="code">{profile.endpoints.par || '(no PAR endpoint: run discovery or set it in the configuration)'}</span>
            </span>
          </div>
          {!par?.pending && (
            <button type="button" className="btn-primary" disabled={pushing || !profile.endpoints.par} onClick={() => void push()}>
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
                {expired ? 'The pushed request has expired. Regenerate and push again.' : `Expires in ${remaining}s. The browser now carries only client_id and request_uri:`}
              </div>
              {!expired && (
                <div className="flex items-start gap-1">
                  <code className="code flex-1 break-all">{par.pending.authorizationUrl}</code>
                  <CopyButton value={par.pending.authorizationUrl} onCopy={() => par.pending && rememberAuthorization(par.pending)} />
                </div>
              )}
            </div>
          )}
          {par && <HttpExchangeView exchange={par.result.exchange} defaultOpen={!par.pending} />}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={!target || expired}
          title={usePar && !par?.pending ? 'Push the request first' : undefined}
          onClick={() => target && navigateToAuthorization(target)}
        >
          <ExternalLink size={15} /> {startLabel ?? 'Start sign-in'}
        </button>
        <button type="button" className="btn-ghost" onClick={regenerate} title="New state, nonce and verifier">
          <RefreshCw size={14} /> Regenerate
        </button>
        <span className="text-xs text-zinc-500">
          Goes to <span className="code">{displayUrl(req.pending.authorizationEndpoint)}</span>; the code is redeemed at{' '}
          <span className="code">{displayUrl(req.pending.tokenEndpoint, 'path')}</span>
          {profile.redeemCodeAutomatically ? ' as soon as it arrives.' : ' when you choose.'}
        </span>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-60' : ''}`}>
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-zinc-500">{hint}</span>
      </span>
    </label>
  )
}

export function AuthorizeView() {
  const profile = useAppState((s) => activeProfile(s))
  const codes = useAppState((s) => s.codes.filter((c) => c.pending.profile.id === s.activeProfileId))
  const problems = profileProblems(profile)
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Authorization Code with PKCE</h2>
        <p className="text-sm text-zinc-500">
          Each step runs when you choose: review the request, push it (PAR) if you like, sign in, then redeem the code or keep it. The server redirects back to{' '}
          <span className="code">{profile.redirectUri || '/callback'}</span>, where the response is checked.
        </p>
      </div>
      {codes.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Codes waiting to be redeemed</h3>
          {codes.map((c) => (
            <ReceivedCodeCard key={c.id} received={c} />
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle
          checked={profile.usePar}
          onChange={(v) => updateProfile(profile.id, { usePar: v })}
          label="Push the request first (PAR)"
          hint={profile.endpoints.par ? 'RFC 9126: send the parameters in a back-channel POST, then redirect with a request_uri.' : 'The server advertises no PAR endpoint. Set one in the configuration to use PAR.'}
        />
        <Toggle
          checked={profile.redeemCodeAutomatically}
          onChange={(v) => updateProfile(profile.id, { redeemCodeAutomatically: v })}
          label="Redeem the code automatically"
          hint="Off: the callback stops after the checks, and you decide whether to redeem the code."
        />
      </div>
      {problems.length > 0 && (
        <Alert tone="blue">
          <ul className="list-inside list-disc">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}
      {problems.length === 0 && <RequestPreview profile={profile} />}
      <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
        <Badge tone="green">state</Badge>
        {profile.useNonce ? <Badge tone="green">nonce</Badge> : <Badge tone="amber">no nonce</Badge>}
        <Badge tone={profile.pkceMethod === 'S256' ? 'green' : 'amber'}>PKCE {profile.pkceMethod}</Badge>
        <Badge tone={profile.expectIss ? 'green' : 'neutral'}>{profile.expectIss ? 'iss required (RFC 9207)' : 'iss checked when sent (RFC 9207)'}</Badge>
        <span>are generated per request, used once and checked on return.</span>
      </div>
    </div>
  )
}
