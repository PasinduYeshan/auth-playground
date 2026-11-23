import { CheckCircle2, Loader2, Radar } from 'lucide-react'
import { useState } from 'react'
import { Alert, CopyButton, SecretInput, cx } from '../components/ui'
import { runDiscovery } from '../lib/flows'
import { PRESETS, presetById } from '../lib/oauth/presets'
import type { ClientAuthMethod, Endpoints, Profile } from '../lib/oauth/types'
import { displayUrl } from '../lib/oauth/url'
import { secretsFor, setSecrets, setState, updateProfile, useAppState } from '../lib/store/appStore'
import { profileProblems } from './AuthorizeView'

const FOUND: [keyof Endpoints, string][] = [
  ['authorization', 'authorize'],
  ['token', 'token'],
  ['jwks', 'JWKS'],
  ['userinfo', 'UserInfo'],
  ['par', 'PAR'],
  ['introspection', 'introspection'],
  ['revocation', 'revocation'],
  ['endSession', 'end session'],
  ['deviceAuthorization', 'device'],
]

const DEFAULT_NAMES = ['My first configuration', 'New configuration']

function Step({ n, done, active, title, children }: { n: number; done: boolean; active: boolean; title: string; children: React.ReactNode }) {
  return (
    <section className={cx('card space-y-4 p-5', active && 'ring-2 ring-indigo-500/60')}>
      <div className="flex items-center gap-2.5">
        <span className={cx('flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold text-white', done ? 'bg-emerald-600' : active ? 'bg-indigo-600' : 'bg-zinc-400')}>
          {done ? <CheckCircle2 size={15} /> : n}
        </span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  )
}

/** First run, or a configuration that cannot sign in yet: the two things to fill in, nothing else. */
export function SetupView({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const secret = useAppState((s) => secretsFor(profile.id, s).clientSecret)
  const discovered = useAppState((s) => !!s.metadata[profile.id])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'red' | 'amber'; text: string }>()
  const preset = presetById(profile.preset)
  const up = (patch: Partial<Profile>) => updateProfile(profile.id, patch)
  const serverDone = !!profile.endpoints.authorization && !!profile.endpoints.token
  const problems = profileProblems(profile)
  const ready = problems.length === 0 && (profile.clientAuthMethod === 'none' || !!secret)

  const discover = async () => {
    if (!profile.issuer.trim()) return
    setBusy(true)
    setMsg(undefined)
    try {
      const r = await runDiscovery(profile)
      if (r.error) setMsg({ tone: 'red', text: `Discovery failed: ${r.error}. The HTTP log has the details.` })
      else {
        if (r.warnings.length) setMsg({ tone: 'amber', text: r.warnings.join(' ') })
        if (DEFAULT_NAMES.includes(profile.name)) up({ name: `${preset.id === 'generic' ? 'Server' : preset.name} · ${displayUrl(profile.issuer).replace(/\/+$/, '')}` })
      }
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Connect a server</h1>
        <p className="text-[15px] text-zinc-500">Two things to fill in. Everything else comes from discovery and can be changed later in Server settings.</p>
      </div>

      <Step n={1} done={serverDone} active={!serverDone} title="Server">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <label className="block">
            <span className="label">Server type</span>
            <select
              className="input h-10"
              value={preset.id}
              onChange={(e) => {
                const next = presetById(e.target.value)
                up({ preset: next.id, b2b: { ...next.b2b(), organizations: profile.b2b.organizations } })
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <label htmlFor="setup-issuer" className="label">
              Issuer URL <span className="text-red-700 dark:text-red-400">(required)</span>
            </label>
            <div className="flex gap-2">
              <input
                id="setup-issuer"
                className={cx('input code h-10 text-[13px]', !profile.issuer && 'border-indigo-400 ring-2 ring-indigo-500/20')}
                value={profile.issuer}
                placeholder={preset.issuerPlaceholder}
                autoFocus={!profile.issuer}
                spellCheck={false}
                onChange={(e) => up({ issuer: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && void discover()}
              />
              <button type="button" className="btn-primary h-10 shrink-0 px-4" disabled={!profile.issuer.trim() || busy} onClick={() => void discover()}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />} Discover
              </button>
            </div>
            <span className="mt-1 block text-[11px] text-zinc-500">{preset.issuerHint}</span>
          </div>
        </div>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {serverDone && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
            <span className="mr-1 font-semibold">{discovered ? 'Discovered:' : 'Endpoints set:'}</span>
            {FOUND.filter(([k]) => profile.endpoints[k]).map(([k, label]) => (
              <span key={k} className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 dark:border-emerald-800 dark:bg-emerald-950">
                {label}
              </span>
            ))}
          </div>
        )}
        <button type="button" className="btn-ghost px-0 text-[13px] text-indigo-700 dark:text-indigo-300" onClick={() => setState({ settingsOpen: true })}>
          No discovery document? Enter the endpoints in Server settings
        </button>
      </Step>

      <Step n={2} done={ready} active={serverDone && !ready} title="Client">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <label className="block">
            <span className="label">
              Client ID <span className="text-red-700 dark:text-red-400">(required)</span>
            </span>
            <input className="input code h-10 text-[13px]" value={profile.clientId} spellCheck={false} placeholder="The client registered for this playground" onChange={(e) => up({ clientId: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Client authentication</span>
            <select className="input h-10" value={profile.clientAuthMethod} onChange={(e) => up({ clientAuthMethod: e.target.value as ClientAuthMethod })}>
              <option value="none">None (public client)</option>
              <option value="client_secret_post">client_secret_post</option>
              <option value="client_secret_basic">client_secret_basic</option>
            </select>
          </label>
        </div>
        {profile.clientAuthMethod !== 'none' && (
          <label className="block">
            <span className="label">Client secret (kept in memory for this tab only, never saved)</span>
            <SecretInput value={secret} onChange={(v) => setSecrets(profile.id, { clientSecret: v })} />
          </label>
        )}
        <div>
          <span className="label">Redirect URI to register on the server</span>
          <div className="flex h-10 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 pr-1 pl-3 dark:border-zinc-800 dark:bg-zinc-950">
            <code className="code flex-1 truncate text-[13px]">{profile.redirectUri}</code>
            <CopyButton value={profile.redirectUri} label="Copy" className="border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary h-10 px-5 font-semibold" disabled={!ready} onClick={onDone}>
            Start testing
          </button>
          {!ready && (
            <span className="text-[13px] text-zinc-500">
              {!serverDone ? 'Discover the server first.' : !profile.clientId ? 'Enter the client ID to continue.' : profile.clientAuthMethod !== 'none' && !secret ? 'Enter the client secret to continue.' : problems[0]}
            </span>
          )}
        </div>
      </Step>

      {preset.notes.length > 0 && (
        <details className="text-[13px] text-zinc-500">
          <summary className="cursor-pointer select-none">Notes for {preset.name}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {preset.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
