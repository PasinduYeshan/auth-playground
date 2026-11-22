import { ArrowRight, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ReceivedCodeCard } from '../components/ReceivedCodeCard'
import { Alert, JsonView } from '../components/ui'
import { ERROR_HINTS } from '../lib/errors'
import { receiveCallback, redeemCode, type CallbackOutcome, type RedeemOutcome } from '../lib/flows'
import { maskValue } from '../lib/oauth/http'
import { getState } from '../lib/store/appStore'

// The callback must run exactly once: the state is single use, and React StrictMode runs effects twice.
let received: CallbackOutcome | undefined
let autoRedeem: Promise<RedeemOutcome> | undefined

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
  const [outcome] = useState<CallbackOutcome>(() => (received ??= receiveCallback(window.location)))
  const [redeemed, setRedeemed] = useState<RedeemOutcome>()

  // Redeeming is a separate step unless the configuration asks for it straight away.
  const auto = !!outcome.received && (getState().profiles.find((p) => p.id === outcome.pending?.profile.id) ?? outcome.pending?.profile)?.redeemCodeAutomatically
  useEffect(() => {
    if (!auto || !outcome.received) return
    autoRedeem ??= redeemCode(outcome.received)
    void autoRedeem.then(setRedeemed)
  }, [auto, outcome.received])

  const cb = outcome.callback
  const shown = cb ? Object.fromEntries(Object.entries(cb.raw).map(([k, v]) => [k, k === 'code' ? maskValue(v) : v])) : undefined
  const done = redeemed?.tokenSet
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
      {outcome.received && (
        <Step
          ok={redeemed ? !!redeemed.tokenSet : auto ? undefined : true}
          title={auto ? (redeemed ? 'Redeemed the code automatically' : 'Redeeming the code (automatic redemption is on)…') : 'Redeem the code, or keep it'}
        >
          {!auto && !redeemed && (
            <p className="text-sm text-zinc-500">
              Nothing has been sent to the token endpoint yet. Redeem the code here, copy the token request to send it yourself, or go back: the code waits under Authorize until you redeem or discard it.
            </p>
          )}
          {(!auto || redeemed) && <ReceivedCodeCard received={outcome.received} outcome={auto ? redeemed : undefined} onRedeemed={setRedeemed} tokensHref={`${home}#tokens`} />}
        </Step>
      )}
      {!done && (
        <a className="btn-ghost" href={home}>
          Back to the playground <ArrowRight size={15} />
        </a>
      )}
    </div>
  )
}
