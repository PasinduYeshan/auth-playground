import { ChevronDown, ChevronRight, KeyRound, Loader2, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import { codeExchangeCurl, redeemCode } from '../lib/flows'
import type { ReceivedCode } from '../lib/oauth/authorize'
import { maskValue } from '../lib/oauth/http'
import { removeSignIn, setState, useAppState, type SignIn } from '../lib/store/appStore'
import { TokenSetDetail } from '../views/TokensView'
import { TokenRequestEditor } from './TokenRequestEditor'
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

type StepState = 'done' | 'active' | 'todo' | 'failed'

function Step({ n, state, title, children }: { n: number; state: StepState; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3 border-t border-zinc-100 py-3 first:border-t-0 dark:border-zinc-800">
      <span
        className={cx(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          state === 'done' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
          state === 'active' && 'bg-indigo-600 text-white',
          state === 'failed' && 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
          state === 'todo' && 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800',
        )}
      >
        {n}
      </span>
      <div className={cx('min-w-0 flex-1 space-y-2', state === 'todo' && 'text-zinc-500')}>
        <div className="text-sm font-medium">{title}</div>
        {children}
      </div>
    </li>
  )
}

/** One sign-in as three steps: the response, the token request, the tokens. */
function SignInSteps({ entry }: { entry: SignIn }) {
  const code = useAppState((s) => s.codes.find((c) => c.id === entry.id))
  const tokenSet = useAppState((s) => s.tokenSets.find((t) => t.id === entry.tokenSetId))
  const reveal = useAppState((s) => s.revealSecrets)
  // The editor keeps the code it was opened with, so it stays open after the code is spent.
  const [editing, setEditing] = useState<ReceivedCode>()
  const [busy, setBusy] = useState(false)
  const serverError = entry.status === 'failed' && !code && !entry.tokenSetId

  const getTokens = async () => {
    if (!code) return
    setBusy(true)
    await redeemCode(code)
    setBusy(false)
  }

  return (
    <ol>
      <Step n={1} state={entry.status === 'waiting' ? 'active' : serverError ? 'failed' : 'done'} title={entry.status === 'waiting' ? 'Waiting for the sign-in' : serverError ? 'The server returned an error' : 'Response received'}>
        {entry.status === 'waiting' && <p className="text-sm text-zinc-500">Finish signing in in the other tab. This updates when the server redirects back.</p>}
        {serverError && entry.message && <p className="text-sm break-words text-red-700 dark:text-red-400">{entry.message}</p>}
        {!serverError && entry.status !== 'waiting' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="green">state matches</Badge>
            {entry.iss ? <Badge tone="green">iss matches</Badge> : <Badge tone="neutral">no iss sent</Badge>}
            {code && <code className="code ml-1 truncate text-zinc-600 dark:text-zinc-400">code = {reveal ? code.code : maskValue(code.code)}</code>}
          </div>
        )}
      </Step>

      {!serverError && (
        <Step
          n={2}
          state={entry.status === 'redeemed' ? 'done' : entry.status === 'failed' ? 'failed' : entry.status === 'code' ? 'active' : 'todo'}
          title={
            <>
              Token request{' '}
              <span className="font-normal text-zinc-500">{entry.status === 'redeemed' ? '· tokens issued' : entry.status === 'failed' ? '· refused' : '· exchange the code for tokens'}</span>
            </>
          }
        >
          {entry.status === 'failed' && entry.message && <p className="text-sm break-words text-red-700 dark:text-red-400">{entry.message}</p>}
          {code && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className="btn-primary px-3 py-1.5 text-[13px]" disabled={busy} onClick={() => void getTokens()}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} {entry.status === 'failed' ? 'Send again' : 'Get tokens'}
              </button>
              <button type="button" className={cx('btn-secondary px-3 py-1.5 text-[13px]', editing && 'bg-zinc-100 dark:bg-zinc-800')} onClick={() => setEditing(editing ? undefined : code)}>
                <Pencil size={13} /> Edit request
              </button>
              <CopyButton value={codeExchangeCurl(code)} label="Copy as curl" className="border border-zinc-200 dark:border-zinc-700" />
            </div>
          )}
          {editing && <TokenRequestEditor key={editing.id} received={editing} />}
        </Step>
      )}

      {!serverError && (
        <Step n={3} state={tokenSet ? 'done' : 'todo'} title={tokenSet ? 'Tokens' : 'Tokens, decoded and checked, show here'}>
          {tokenSet && (
            <>
              <TokenSetDetail set={tokenSet} />
              <button type="button" className="btn-ghost px-0 text-[13px] text-indigo-700 dark:text-indigo-300" onClick={() => setState({ view: 'tokens', selectedTokenSetId: tokenSet.id })}>
                Open in Tokens
              </button>
            </>
          )}
        </Step>
      )}
    </ol>
  )
}

/** The latest sign-in in full, with earlier ones a click away. With `organizationsOnly`, only
 * sign-ins to an organization (the ones the Organizations page starts). */
export function SignInResult({ organizationsOnly = false }: { organizationsOnly?: boolean }) {
  const signIns = useAppState((s) => (organizationsOnly ? s.signIns.filter((x) => x.organization) : s.signIns))
  const [pickedId, setPickedId] = useState<string>()
  const [showEarlier, setShowEarlier] = useState(false)
  if (signIns.length === 0) return null
  const shown = signIns.find((x) => x.id === pickedId) ?? signIns[0]
  const others = signIns.filter((x) => x.id !== shown.id)

  return (
    <section aria-label="Sign-in result" className="card px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-2 pb-1">
        <span className={cx('h-2 w-2 rounded-full', DOT[shown.status])} aria-hidden="true" />
        <h2 className="font-semibold">{shown.id === signIns[0].id ? (organizationsOnly ? 'Latest organization sign-in' : 'Latest sign-in') : 'Sign-in'}</h2>
        <span className="text-xs text-zinc-500">
          {new Date(shown.startedAt).toLocaleTimeString()} · {shown.label}
          {shown.viaPar ? ' · PAR' : ''}
        </span>
        <span className="flex-1" />
        {others.length > 0 && (
          <button type="button" className="btn-ghost px-2 py-1 text-[13px] text-indigo-700 dark:text-indigo-300" aria-expanded={showEarlier} onClick={() => setShowEarlier(!showEarlier)}>
            {others.length} other{others.length > 1 ? 's' : ''} {showEarlier ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        <button type="button" className="btn-ghost px-1.5 py-1" aria-label="Remove this sign-in" title="Remove this sign-in" onClick={() => removeSignIn(shown.id)}>
          <X size={14} />
        </button>
      </div>
      {showEarlier && (
        <ul className="mb-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {others.map((x) => (
            <li key={x.id}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60" onClick={() => { setPickedId(x.id); setShowEarlier(false) }}>
                <span className={cx('h-2 w-2 rounded-full', DOT[x.status])} aria-hidden="true" />
                <span className="font-medium">{TITLE[x.status]}</span>
                <span className="truncate text-zinc-500">{x.label}</span>
                <span className="flex-1" />
                <span className="text-xs text-zinc-500">{new Date(x.startedAt).toLocaleTimeString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <SignInSteps key={shown.id} entry={shown} />
    </section>
  )
}
