import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert, JsonView } from '../components/ui'
import { ERROR_HINTS } from '../lib/errors'
import { acceptResponse, type CallbackOutcome } from '../lib/flows'
import { offerResponse } from '../lib/handoff'
import { hasPending, parseCallback, takePending } from '../lib/oauth/authorize'
import { maskValue } from '../lib/oauth/http'

// The callback must run exactly once: the state is single use, and React StrictMode runs effects twice.
let started = false

type Phase = 'handing' | 'sent' | 'here' | 'unmatched'

/** The sign-in tab after the redirect. It hands the response to the playground tab that started the
 * request and closes. If no playground tab takes it, the response is completed here. */
export function CallbackView({ home }: { home: string }) {
  const [phase, setPhase] = useState<Phase>(() => (parseCallback(window.location) ? 'handing' : 'unmatched'))
  const [outcome, setOutcome] = useState<CallbackOutcome | undefined>(() =>
    parseCallback(window.location) ? undefined : { error: 'This page expects an authorization response (code or error) in the URL.' },
  )

  useEffect(() => {
    if (started) return
    started = true
    const callback = parseCallback(window.location)
    if (!callback) return
    // Drop the code from the address bar and history straight away.
    window.history.replaceState(null, '', window.location.pathname)
    void offerResponse(callback.raw, callback.source).then(async (taken) => {
      if (taken) {
        // Some browsers copy the opener's session storage into the new tab: drop that copy.
        if (callback.state) takePending(callback.state)
        setPhase('sent')
        setTimeout(() => window.close(), 1200)
        return
      }
      if (callback.state && hasPending(callback.state)) {
        // The response came back to the tab that started it (pop-ups blocked, or a copied URL opened
        // here): complete it, then return to the playground, where it shows under Sign-ins.
        setPhase('here')
        const result = acceptResponse(callback)
        if (result.redeeming) await result.redeeming
        window.location.replace(`${home}#authorize`)
        return
      }
      setOutcome(acceptResponse(callback))
      setPhase('unmatched')
    })
  }, [home])

  if (phase === 'handing' || phase === 'here')
    return (
      <div className="mx-auto flex max-w-md items-center justify-center gap-2 py-16 text-zinc-500">
        <Loader2 size={18} className="animate-spin" /> {phase === 'handing' ? 'Sending the response to the playground…' : 'Completing the sign-in…'}
      </div>
    )

  if (phase === 'sent')
    return (
      <div className="card mx-auto max-w-md space-y-3 p-7 text-center">
        <CheckCircle2 size={40} className="mx-auto text-emerald-600" />
        <h1 className="text-lg font-semibold">Sent to the playground</h1>
        <p className="text-sm text-zinc-500">The response is in your playground tab, under Sign-ins. This tab closes in a moment.</p>
        <div className="flex justify-center gap-2">
          <button type="button" className="btn-primary" onClick={() => window.close()}>
            Close tab
          </button>
        </div>
      </div>
    )

  const cb = outcome?.callback
  const shown = cb ? Object.fromEntries(Object.entries(cb.raw).map(([k, v]) => [k, k === 'code' ? maskValue(v) : v])) : undefined
  return (
    <div className="card mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center gap-2">
        <XCircle size={22} className="text-red-600" />
        <h1 className="text-lg font-semibold">{cb?.error ? `The server returned an error: ${cb.error}` : 'No playground tab is waiting for this response'}</h1>
      </div>
      {outcome?.error && <Alert tone="red">{outcome.error}</Alert>}
      {cb?.errorDescription && <p className="text-sm">{cb.errorDescription}</p>}
      {cb?.error && ERROR_HINTS[cb.error] && <p className="text-sm text-zinc-500">{ERROR_HINTS[cb.error]}</p>}
      {outcome?.check && !outcome.check.ok && !cb?.error && (
        <div className="space-y-2">
          {outcome.check.problems.map((p) => (
            <Alert key={p} tone="red">
              {p}
            </Alert>
          ))}
          <p className="text-sm text-zinc-500">The request is held by the tab that started it. If that tab was closed or reloaded in another window, start the sign-in again.</p>
        </div>
      )}
      {shown && <JsonView value={shown} />}
      <a className="btn-secondary" href={home}>
        Go to the playground
      </a>
    </div>
  )
}
