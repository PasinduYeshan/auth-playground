import { ArrowRight, KeyRound, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ERROR_HINTS } from '../lib/errors'
import { codeExchangeCurl, redeemCode, type RedeemOutcome } from '../lib/flows'
import type { ReceivedCode } from '../lib/oauth/authorize'
import { maskValue } from '../lib/oauth/http'
import { removeCode, useAppState } from '../lib/store/appStore'
import { HttpExchangeView } from './HttpExchangeView'
import { Alert, CopyButton } from './ui'

function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)} min ago`
}

/** One received authorization code: redeem it, copy the token request, or leave it. */
export function ReceivedCodeCard({ received, outcome: external, onRedeemed, tokensHref }: {
  received: ReceivedCode
  /** A redemption made elsewhere (automatic redemption on the callback page). */
  outcome?: RedeemOutcome
  onRedeemed?: (outcome: RedeemOutcome) => void
  /** Link to the tokens after a successful redemption (the callback page lives outside the app shell). */
  tokensHref?: string
}) {
  const reveal = useAppState((s) => s.revealSecrets)
  const stillHeld = useAppState((s) => s.codes.some((c) => c.id === received.id))
  const [busy, setBusy] = useState(false)
  const [own, setOutcome] = useState<RedeemOutcome>()
  const outcome = own ?? external
  const [now, setNow] = useState(() => received.receivedAt)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  const redeem = async () => {
    setBusy(true)
    const o = await redeemCode(received)
    setBusy(false)
    setOutcome(o)
    onRedeemed?.(o)
  }

  const { pending, code } = received
  const err = outcome?.grant?.error?.error
  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-medium">{pending.label ?? (pending.organization ? `Sign in to ${pending.organization.name}` : 'Authorization code')}</div>
        <div className="text-xs text-zinc-500">received {age(Math.max(now, received.receivedAt) - received.receivedAt)}{pending.par ? ' · via PAR' : ''}</div>
      </div>
      <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="text-zinc-500">code</dt>
        <dd className="flex items-start gap-1">
          <code className="code flex-1 break-all">{reveal ? code : maskValue(code)}</code>
          <CopyButton value={code} />
        </dd>
        <dt className="text-zinc-500">code_verifier</dt>
        <dd className="flex items-start gap-1">
          <code className="code flex-1 break-all">{reveal ? pending.codeVerifier : maskValue(pending.codeVerifier)}</code>
          <CopyButton value={pending.codeVerifier} />
        </dd>
        <dt className="text-zinc-500">redirect_uri</dt>
        <dd className="code break-all">{pending.profile.redirectUri}</dd>
        <dt className="text-zinc-500">Token endpoint</dt>
        <dd className="code break-all">{pending.tokenEndpoint || '(not set)'}</dd>
      </dl>

      {stillHeld && !outcome?.tokenSet && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void redeem()}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Redeem for tokens
          </button>
          <CopyButton value={codeExchangeCurl(received)} label="Copy token request as curl" />
          <button type="button" className="btn-ghost" onClick={() => removeCode(received.id)} title="Forget this code without redeeming it">
            <Trash2 size={14} /> Discard
          </button>
          <span className="text-xs text-zinc-500">Codes are single use and usually expire within minutes.</span>
        </div>
      )}

      {outcome?.error && <Alert tone="red">{outcome.error}</Alert>}
      {outcome?.grant && (
        <div className="space-y-2">
          {outcome.grant.tokens ? (
            <Alert tone="green">Redeemed the code for tokens.</Alert>
          ) : (
            <Alert tone="red">
              Token request failed: {err}
              {outcome.grant.error?.error_description ? `. ${outcome.grant.error.error_description}` : ''}
              {err && ERROR_HINTS[err] && <div className="mt-1 text-zinc-600 dark:text-zinc-400">{ERROR_HINTS[err]}</div>}
            </Alert>
          )}
          <HttpExchangeView exchange={outcome.grant.exchange} defaultOpen={!outcome.grant.tokens} />
          {outcome.tokenSet && tokensHref && (
            <a className="btn-primary" href={tokensHref}>
              Inspect the tokens <ArrowRight size={15} />
            </a>
          )}
        </div>
      )}
    </div>
  )
}
