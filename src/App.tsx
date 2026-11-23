import { Activity, ArrowLeftRight, Building2, ExternalLink, KeyRound, Moon, SlidersHorizontal, Sun, Workflow, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cx } from './components/ui'
import { activeProfile, setState, useAppState, type ViewName } from './lib/store/appStore'
import { listenForSignInResponses } from './lib/flows'
import { displayUrl } from './lib/oauth/url'
import { SignInsPanel } from './components/SignIns'
import { SetupView } from './views/SetupView'
import { AuthorizeView, profileProblems } from './views/AuthorizeView'
import { CallbackView } from './views/CallbackView'
import { CompareView } from './views/CompareView'
import { ConfigPanel } from './views/ConfigPanel'
import { GrantsView } from './views/GrantsView'
import { HttpLogView } from './views/HttpLogView'
import { OrganizationsView } from './views/OrganizationsView'
import { TokensView, takeLogoutResult } from './views/TokensView'
import { Alert } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'

const BASE = import.meta.env.BASE_URL

function isCallbackPage(): boolean {
  const path = window.location.pathname.slice(BASE.length - 1).replace(/\/+$/, '')
  return path === '/callback'
}

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem('ap:theme')
      return stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      return false
    }
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  return [
    dark,
    () => {
      setDark(!dark)
      try {
        localStorage.setItem('ap:theme', dark ? 'light' : 'dark')
      } catch {
        // ignore
      }
    },
  ]
}

const FLOWS: { id: ViewName; label: string; icon: ReactNode }[] = [
  { id: 'authorize', label: 'Sign-in (code)', icon: <ExternalLink size={16} /> },
  { id: 'grants', label: 'Other grants', icon: <Workflow size={16} /> },
  { id: 'organizations', label: 'Organizations', icon: <Building2 size={16} /> },
]
const RESULTS: { id: ViewName; label: string; icon: ReactNode }[] = [
  { id: 'tokens', label: 'Tokens', icon: <KeyRound size={16} /> },
  { id: 'compare', label: 'Compare', icon: <ArrowLeftRight size={16} /> },
  { id: 'http', label: 'HTTP log', icon: <Activity size={16} /> },
]
const ALL = [...FLOWS, ...RESULTS]

function Logo() {
  return (
    <a href={BASE} className="flex items-center gap-2 font-semibold">
      <img src={`${BASE}favicon.svg`} alt="" className="h-7 w-7" />
      <span className="hidden sm:inline">Auth Playground</span>
    </a>
  )
}

/** The active configuration, switchable from the header, with a dot for whether it can sign in. */
function ServerSwitcher() {
  const profiles = useAppState((s) => s.profiles)
  const profile = useAppState((s) => activeProfile(s))
  const ready = profileProblems(profile).length === 0
  const host = (profile.issuer ? displayUrl(profile.issuer) : profile.endpoints.authorization ? displayUrl(profile.endpoints.authorization) : '').replace(/\/+$/, '')
  const showHost = host && !profile.name.includes(host)
  return (
    <div className={cx('flex h-9 min-w-0 items-center gap-2 rounded-lg border pl-3', ready ? 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900' : 'border-dashed border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40')}>
      <span className={cx('h-2 w-2 shrink-0 rounded-full', ready ? 'bg-emerald-600' : 'bg-amber-500')} title={ready ? 'Ready to sign in' : 'Not connected yet'} />
      <select
        aria-label="Configuration"
        className="input h-8 max-w-[16rem] min-w-0 truncate border-0 bg-transparent pl-0 font-medium shadow-none focus:ring-0 dark:bg-transparent"
        value={profile.id}
        onChange={(e) => setState({ activeProfileId: e.target.value, openCode: undefined })}
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {showHost && <span className="code hidden shrink-0 pr-3 text-zinc-500 md:inline">{host}</span>}
      {!ready && <span className="hidden pr-3 text-xs font-medium whitespace-nowrap text-amber-800 md:inline dark:text-amber-300">Not connected</span>}
    </div>
  )
}

function Header({ dark, toggle, showServer = true }: { dark: boolean; toggle: () => void; showServer?: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="flex h-14 items-center gap-3 px-4">
        <Logo />
        {showServer && <ServerSwitcher />}
        <span className="flex-1" />
        {showServer && (
          <button type="button" className="btn-secondary h-9" onClick={() => setState({ settingsOpen: true })}>
            <SlidersHorizontal size={15} /> <span className="hidden sm:inline">Server settings</span>
          </button>
        )}
        <button type="button" className="btn-secondary h-9 w-9 px-0" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  )
}

function NavGroup({ title, items, view }: { title: string; items: typeof FLOWS; view: ViewName }) {
  const tokenCount = useAppState((s) => s.tokenSets.length)
  return (
    <>
      <div className="hidden px-2.5 pt-3 pb-1.5 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase md:block">{title}</div>
      {items.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => setState({ view: n.id })}
          aria-current={view === n.id ? 'page' : undefined}
          className={cx(
            'flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm whitespace-nowrap transition',
            view === n.id ? 'bg-indigo-50 font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300' : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
          )}
        >
          {n.icon}
          <span className="flex-1">{n.label}</span>
          {n.id === 'tokens' && tokenCount > 0 && <span className="rounded-full bg-zinc-100 px-1.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{tokenCount}</span>}
        </button>
      ))}
    </>
  )
}

/** Server settings as a drawer over the page: the full configuration, out of the way while testing. */
function SettingsDrawer() {
  const open = useAppState((s) => s.settingsOpen)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setState({ settingsOpen: false })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button type="button" aria-label="Close Server settings" className="absolute inset-0 bg-zinc-950/30" onClick={() => setState({ settingsOpen: false })} />
      <div role="dialog" aria-modal="true" aria-label="Server settings" className="relative flex h-full w-full max-w-[460px] flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <h2 className="flex-1 font-semibold">Server settings</h2>
          <button type="button" className="btn-ghost px-2" aria-label="Close" onClick={() => setState({ settingsOpen: false })}>
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ErrorBoundary area="Server settings">
            <ConfigPanel />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}

const FLOW_VIEWS: ViewName[] = ['authorize', 'grants', 'organizations']

export default function App() {
  const [dark, toggle] = useTheme()
  const view = useAppState((s) => s.view)
  const profile = useAppState((s) => activeProfile(s))
  const [logout, setLogout] = useState(() => (isCallbackPage() ? undefined : takeLogoutResult()))
  // The setup screen shows for a configuration that cannot sign in yet, and stays until the user
  // presses Start testing, so it does not vanish mid-typing.
  const [setupFor, setSetupFor] = useState<string | undefined>(() => (profileProblems(activeProfile()).length ? activeProfile().id : undefined))
  const [lastProfile, setLastProfile] = useState(profile.id)
  if (lastProfile !== profile.id) {
    setLastProfile(profile.id)
    setSetupFor(profileProblems(profile).length ? profile.id : undefined)
  }
  const inSetup = setupFor === profile.id && FLOW_VIEWS.includes(view)
  const callbackPage = isCallbackPage()

  useEffect(() => (callbackPage ? undefined : listenForSignInResponses()), [callbackPage])

  if (callbackPage)
    return (
      <>
        <Header dark={dark} toggle={toggle} showServer={false} />
        <main className="px-4 py-10">
          <ErrorBoundary area="callback page">
            <CallbackView home={BASE} />
          </ErrorBoundary>
        </main>
      </>
    )

  const showSignIns = !inSetup && (view === 'authorize' || view === 'organizations')
  return (
    <>
      <Header dark={dark} toggle={toggle} />
      <div className="flex min-h-[calc(100vh-3.5rem)] flex-wrap items-stretch">
        <nav aria-label="Views" className="flex w-full flex-row gap-0.5 overflow-x-auto border-b border-zinc-200 bg-white p-2 md:w-56 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <NavGroup title="Flows" items={FLOWS} view={view} />
          <NavGroup title="Results" items={RESULTS} view={view} />
        </nav>
        <main className="min-w-0 flex-[999_1_560px] space-y-4 p-4 sm:p-6">
          {logout && (
            <Alert tone={logout === 'ok' ? 'green' : 'red'}>
              <div className="flex items-start gap-2">
                <span className="flex-1">
                  {logout === 'ok'
                    ? 'Signed out at the server: the logout response came back with the state that was sent. The tokens in this tab are untouched; revoke them separately if needed.'
                    : 'A logout response came back with a state that does not match the one sent.'}
                </span>
                <button type="button" className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => setLogout(undefined)} aria-label="Dismiss">
                  <X size={14} />
                </button>
              </div>
            </Alert>
          )}
          <ErrorBoundary key={inSetup ? 'setup' : view} area={inSetup ? 'setup' : `${ALL.find((n) => n.id === view)?.label ?? 'view'} view`}>
            {inSetup ? (
              <SetupView profile={profile} onDone={() => setSetupFor(undefined)} />
            ) : (
              <>
                {view === 'authorize' && <AuthorizeView />}
                {view === 'grants' && <GrantsView />}
                {view === 'tokens' && <TokensView />}
                {view === 'organizations' && <OrganizationsView />}
                {view === 'compare' && <CompareView />}
                {view === 'http' && <HttpLogView />}
              </>
            )}
          </ErrorBoundary>
        </main>
        {showSignIns && (
          <aside aria-label="Sign-ins" className="w-full border-t border-zinc-200 bg-white p-4 sm:p-5 lg:w-[22rem] lg:shrink-0 lg:border-t-0 lg:border-l xl:w-[26rem] dark:border-zinc-800 dark:bg-zinc-900">
            <ErrorBoundary area="Sign-ins">
              <SignInsPanel />
            </ErrorBoundary>
          </aside>
        )}
      </div>
      <SettingsDrawer />
    </>
  )
}
