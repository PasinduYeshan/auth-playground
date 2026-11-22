import { ExternalLink, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, CopyButton } from '../components/ui'
import { navigateToAuthorization, prepareAuthorization } from '../lib/flows'
import type { AuthorizationRequest } from '../lib/oauth/authorize'
import type { Organization, Profile } from '../lib/oauth/types'
import { activeProfile, useAppState } from '../lib/store/appStore'

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
}

export function profileProblems(profile: Profile): string[] {
  const p: string[] = []
  if (!profile.endpoints.authorization) p.push('Set the authorization endpoint (run discovery).')
  if (!profile.endpoints.token) p.push('Set the token endpoint (run discovery).')
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
  const key = JSON.stringify([profile, org, overrides])

  const regenerate = useCallback(() => {
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

  if (error) return <Alert tone="amber">{error}</Alert>
  if (!req) return null
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
              <CopyButton value={req.url} />
            </div>
          </div>
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={() => navigateToAuthorization(req.pending)}>
          <ExternalLink size={15} /> {startLabel ?? 'Start sign-in'}
        </button>
        <button type="button" className="btn-ghost" onClick={regenerate} title="New state, nonce and verifier">
          <RefreshCw size={14} /> Regenerate
        </button>
        <span className="text-xs text-zinc-500">
          Goes to <span className="code">{new URL(req.pending.authorizationEndpoint).host + new URL(req.pending.authorizationEndpoint).pathname}</span>; the code is redeemed at{' '}
          <span className="code">{req.pending.tokenEndpoint ? new URL(req.pending.tokenEndpoint).pathname : '?'}</span>.
        </span>
      </div>
    </div>
  )
}

export function AuthorizeView() {
  const profile = useAppState((s) => activeProfile(s))
  const problems = profileProblems(profile)
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Authorization Code with PKCE</h2>
        <p className="text-sm text-zinc-500">
          Review the request, then sign in. The server redirects back to <span className="code">{profile.redirectUri || '/callback'}</span>, where the code is checked and redeemed.
        </p>
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
        <Badge tone="green">nonce</Badge>
        <Badge tone="green">PKCE S256</Badge>
        <Badge tone="green">iss check (RFC 9207)</Badge>
        <span>are generated per request, used once and checked on return.</span>
      </div>
    </div>
  )
}
