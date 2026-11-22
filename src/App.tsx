import { Activity, ArrowLeftRight, Building2, KeyRound, Moon, PlayCircle, Sun, Workflow } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cx } from './components/ui'
import { setState, useAppState, type ViewName } from './lib/store/appStore'
import { AuthorizeView } from './views/AuthorizeView'
import { CallbackView } from './views/CallbackView'
import { CompareView } from './views/CompareView'
import { ConfigPanel } from './views/ConfigPanel'
import { GrantsView } from './views/GrantsView'
import { HttpLogView } from './views/HttpLogView'
import { OrganizationsView } from './views/OrganizationsView'
import { TokensView, takeLogoutResult } from './views/TokensView'
import { Alert } from './components/ui'

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

const NAV: { id: ViewName; label: string; icon: ReactNode }[] = [
  { id: 'authorize', label: 'Authorize', icon: <PlayCircle size={16} /> },
  { id: 'grants', label: 'Other grants', icon: <Workflow size={16} /> },
  { id: 'tokens', label: 'Tokens', icon: <KeyRound size={16} /> },
  { id: 'organizations', label: 'Organizations', icon: <Building2 size={16} /> },
  { id: 'compare', label: 'Compare', icon: <ArrowLeftRight size={16} /> },
  { id: 'http', label: 'HTTP log', icon: <Activity size={16} /> },
]

function Logo() {
  return (
    <a href={BASE} className="flex items-center gap-2 font-semibold">
      <img src={`${BASE}favicon.svg`} alt="" className="h-7 w-7" />
      <span>Auth Playground</span>
    </a>
  )
}

function Header({ dark, toggle }: { dark: boolean; toggle: () => void }) {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
        <Logo />
        <span className="hidden text-xs text-zinc-500 md:block">OAuth 2.0 and OpenID Connect, in your browser</span>
        <span className="flex-1" />
        <button type="button" className="btn-ghost px-2" onClick={toggle} title="Toggle theme">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  )
}

export default function App() {
  const [dark, toggle] = useTheme()
  const view = useAppState((s) => s.view)
  const tokenCount = useAppState((s) => s.tokenSets.length)
  const [logout, setLogout] = useState(() => (isCallbackPage() ? undefined : takeLogoutResult()))

  if (isCallbackPage())
    return (
      <>
        <Header dark={dark} toggle={toggle} />
        <main className="px-4 py-8">
          <CallbackView home={BASE} />
        </main>
      </>
    )

  return (
    <>
      <Header dark={dark} toggle={toggle} />
      <div className="mx-auto grid max-w-[1600px] gap-4 p-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="card h-fit overflow-hidden lg:sticky lg:top-18 lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto">
          <ConfigPanel />
        </aside>
        <main className="min-w-0 space-y-4">
          {logout && (
            <div onClick={() => setLogout(undefined)} role="presentation">
              <Alert tone={logout === 'ok' ? 'green' : 'red'}>
                {logout === 'ok'
                  ? 'Signed out at the server: the logout response came back with the state that was sent. The tokens in this tab are untouched; revoke them separately if needed.'
                  : 'A logout response came back with a state that does not match the one sent.'}
              </Alert>
            </div>
          )}
          <nav className="card flex gap-1 overflow-x-auto p-1">
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setState({ view: n.id })}
                className={cx(
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition',
                  view === n.id ? 'bg-indigo-600 text-white' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
                )}
              >
                {n.icon}
                {n.label}
                {n.id === 'tokens' && tokenCount > 0 && <span className={cx('rounded-full px-1.5 text-[10px]', view === n.id ? 'bg-white/25' : 'bg-zinc-200 dark:bg-zinc-700')}>{tokenCount}</span>}
              </button>
            ))}
          </nav>
          <div className="card p-4 sm:p-5">
            {view === 'authorize' && <AuthorizeView />}
            {view === 'grants' && <GrantsView />}
            {view === 'tokens' && <TokensView />}
            {view === 'organizations' && <OrganizationsView />}
            {view === 'compare' && <CompareView />}
            {view === 'http' && <HttpLogView />}
          </div>
        </main>
      </div>
    </>
  )
}
