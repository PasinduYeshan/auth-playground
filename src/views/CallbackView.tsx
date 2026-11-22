import { ArrowRight, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { HttpExchangeView } from '../components/HttpExchangeView'
import { Alert, JsonView } from '../components/ui'
import { completeCallback, type CallbackOutcome } from '../lib/flows'
import { maskValue } from '../lib/oauth/http'

// The callback must run exactly once: the state is single use, and React StrictMode runs effects twice.
let pendingRun: Promise<CallbackOutcome> | undefined

const ERROR_HINTS: Record<string, string> = {
  access_denied: 'The user or the server refused the request.',
  unauthorized_client: 'The client may not use this flow, or it is not available in the requested organization.',
  invalid_request: 'A parameter is missing or malformed. Check the redirect URI, PKCE method and scope.',
  invalid_scope: 'A requested scope is unknown or not allowed for this client.',
  login_required: 'prompt=none was sent but there is no session to reuse. Sign in interactively.',
  interaction_required: 'prompt=none was sent but the server needs the user.',
  consent_required: 'prompt=none was sent but consent is needed.',
  invalid_target: 'A resource indicator is unknown or not allowed.',
  invalid_grant: 'The code is invalid, expired, already used, or the PKCE verifier or redirect URI does not match.',
  invalid_client: 'Client authentication failed: check the client ID, method and secret.',
  network_error: 'The browser blocked the token request. Most often the server does not allow this origin (CORS).',
}

function Step({ ok, title, children }: { ok: boolean | undefined; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5">
        {ok === undefined ? <Loader2 size={18} className="animate-spin text-zinc-400" /> : ok ? <CheckCircle2 size={18} className="text-emerald-500" /> : <XCircle size={18} className="text-red-500" />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="font-medium">{title}</div>
        {children}
      </div>
    </div>
  )
}

export function CallbackView({ home }: { home: string }) {
  const [outcome, setOutcome] = useState<CallbackOutcome>()

  useEffect(() => {
    pendingRun ??= completeCallback(window.location)
    void pendingRun.then(setOutcome)
  }, [])

  if (!outcome) return <Step ok={undefined} title="Processing the authorization response…" />

  const cb = outcome.callback
  const shown = cb ? Object.fromEntries(Object.entries(cb.raw).map(([k, v]) => [k, k === 'code' ? maskValue(v) : v])) : undefined
  const err = cb?.error ?? outcome.grant?.error?.error
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="text-xl font-semibold">Authorization response</h1>
      {outcome.error && !cb && <Alert tone="red">{outcome.error}</Alert>}
      {cb && (
        <Step ok={!cb.error} title={cb.error ? `The server returned an error: ${cb.error}` : 'Received an authorization code'}>
          {cb.errorDescription && <p className="text-sm">{cb.errorDescription}</p>}
          {cb.error && ERROR_HINTS[cb.error] && <p className="text-sm text-zinc-500">{ERROR_HINTS[cb.error]}</p>}
          <JsonView value={shown} />
          <p className="text-xs text-zinc-500">Returned in the {cb.source}. The code was removed from the address bar.</p>
        </Step>
      )}
      {outcome.check && (
        <Step ok={outcome.check.ok} title={outcome.check.ok ? `State matched${cb?.iss ? ' and iss matched the issuer' : ''}` : 'Response checks failed'}>
          {outcome.check.problems.map((p) => (
            <Alert key={p} tone="red">
              {p}
            </Alert>
          ))}
          {outcome.check.ok && !cb?.iss && <p className="text-xs text-zinc-500">The server sent no iss parameter (RFC 9207).</p>}
        </Step>
      )}
      {outcome.grant && (
        <Step ok={!!outcome.grant.tokens} title={outcome.grant.tokens ? 'Redeemed the code for tokens' : `Token request failed: ${outcome.grant.error?.error}`}>
          {outcome.grant.error?.error_description && <p className="text-sm">{outcome.grant.error.error_description}</p>}
          {err && ERROR_HINTS[err] && !outcome.grant.tokens && <p className="text-sm text-zinc-500">{ERROR_HINTS[err]}</p>}
          <HttpExchangeView exchange={outcome.grant.exchange} defaultOpen={!outcome.grant.tokens} />
        </Step>
      )}
      {outcome.error && cb && <Alert tone="red">{outcome.error}</Alert>}
      <a className="btn-primary" href={outcome.tokenSet ? `${home}#tokens` : home}>
        {outcome.tokenSet ? 'Inspect the tokens' : 'Back to the playground'} <ArrowRight size={15} />
      </a>
    </div>
  )
}
