import { KeyRound, Trash2, X } from 'lucide-react'
import { codeExchangeCurl } from '../lib/flows'
import { maskValue } from '../lib/oauth/http'
import { removeSignIn, setState, useAppState, type SignIn } from '../lib/store/appStore'
import { Badge, CopyButton, cx } from './ui'

const DOT: Record<SignIn['status'], string> = {
  waiting: 'bg-amber-500',
  code: 'bg-indigo-600',
  redeemed: 'bg-emerald-600',
  failed: 'bg-red-600',
}

const TITLE: Record<SignIn['status'], string> = {
  waiting: 'Waiting for sign-in',
  code: 'Code received',
  redeemed: 'Tokens issued',
  failed: 'Failed',
}

function SignInCard({ entry }: { entry: SignIn }) {
  const code = useAppState((s) => s.codes.find((c) => c.id === entry.id))
  const reveal = useAppState((s) => s.revealSecrets)
  const open = useAppState((s) => s.openCode?.id === entry.id)
  const time = new Date(entry.startedAt).toLocaleTimeString()
  return (
    <article
      className={cx(
        'space-y-2 rounded-lg border p-3',
        entry.status === 'code' ? 'border-indigo-300 bg-indigo-50/40 dark:border-indigo-800 dark:bg-indigo-950/30' : 'border-zinc-200 dark:border-zinc-800',
        open && 'ring-2 ring-indigo-500/40',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cx('h-2 w-2 shrink-0 rounded-full', DOT[entry.status])} aria-hidden="true" />
        <span className="flex-1 truncate font-medium">{TITLE[entry.status]}</span>
        <span className="text-xs text-zinc-500">{time}</span>
        <button type="button" className="btn-ghost -mr-1 px-1 py-0.5" aria-label="Remove from the list" title="Remove from the list" onClick={() => removeSignIn(entry.id)}>
          <X size={14} />
        </button>
      </div>
      <div className="text-xs text-zinc-500">
        {entry.label}
        {entry.viaPar ? ' · PAR' : ''}
      </div>
      {entry.status === 'waiting' && <p className="text-sm text-zinc-600 dark:text-zinc-400">Finish signing in in the other tab. This updates when the server redirects back.</p>}
      {entry.status === 'failed' && entry.message && <p className="text-sm break-words text-red-700 dark:text-red-400">{entry.message}</p>}
      {code && (
        <>
          {entry.status === 'code' && (
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="green">state matches</Badge>
              {entry.iss ? <Badge tone="green">iss matches</Badge> : <Badge tone="neutral">no iss sent</Badge>}
            </div>
          )}
          <code className="code block truncate rounded-md bg-zinc-100 px-2 py-1.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">code = {reveal ? code.code : maskValue(code.code)}</code>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className="btn-primary px-2.5 py-1 text-[13px]" onClick={() => setState({ openCode: code, view: 'authorize' })}>
              <KeyRound size={14} /> {entry.status === 'failed' ? 'Send again' : 'Get tokens'}
            </button>
            <CopyButton value={codeExchangeCurl(code)} label="Copy as curl" className="border border-zinc-200 dark:border-zinc-700" />
            {entry.status === 'code' && (
              <button type="button" className="btn-ghost px-2 py-1 text-[13px]" title="Forget this code without redeeming it" onClick={() => removeSignIn(entry.id)}>
                <Trash2 size={13} /> Discard
              </button>
            )}
          </div>
        </>
      )}
      {entry.status === 'redeemed' && (
        <button type="button" className="btn-secondary px-2.5 py-1 text-[13px]" onClick={() => setState({ view: 'tokens', selectedTokenSetId: entry.tokenSetId })}>
          Open in Tokens
        </button>
      )}
    </article>
  )
}

/** Every sign-in started from this tab, from waiting to tokens or an error. */
export function SignInsPanel() {
  const signIns = useAppState((s) => s.signIns)
  const finished = signIns.filter((x) => x.status === 'redeemed' || x.status === 'failed')
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[15px] font-semibold">Sign-ins</h2>
        {finished.length > 0 && (
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => finished.forEach((x) => removeSignIn(x.id))}>
            Clear finished
          </button>
        )}
      </div>
      {signIns.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
          Sign-ins you start show up here. Each opens in its own tab, so you can run several at once.
        </p>
      ) : (
        signIns.map((x) => <SignInCard key={x.id} entry={x} />)
      )}
    </div>
  )
}
