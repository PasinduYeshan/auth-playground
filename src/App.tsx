import { Activity, Building2, ChevronDown, ExternalLink, KeyRound, Moon, Save, Sun, Workflow, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './components/ui'
import { activeProfile, setState, useAppState, type ViewName } from './lib/store/appStore'
import { listenForSignInResponses } from './lib/flows'
import { AuthorizeView } from './views/AuthorizeView'
import { CallbackView } from './views/CallbackView'
import { ProfileBar } from './views/ConfigPanel'
import { SignInResult } from './components/SignIns'
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

const TABS: { id: ViewName; label: string; icon: ReactNode }[] = [
  { id: 'authorize', label: 'Sign in', icon: <ExternalLink size={16} /> },
  { id: 'grants', label: 'Other grants', icon: <Workflow size={16} /> },
  { id: 'tokens', label: 'Tokens', icon: <KeyRound size={16} /> },
  { id: 'organizations', label: 'Organizations', icon: <Building2 size={16} /> },
  { id: 'http', label: 'HTTP log', icon: <Activity size={16} /> },
]

function Logo() {
  return (
    <a href={BASE} className="flex shrink-0 items-center gap-2 font-semibold">
      <img src={`${BASE}favicon.svg`} alt="" className="h-7 w-7" />
      <span className="hidden lg:inline">Auth Playground</span>
    </a>
  )
}

/** Saved configurations: switch, add, duplicate, import, export, rename, delete. */
function SavedMenu() {
  const profile = useAppState((s) => activeProfile(s))
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" className="btn-secondary h-9 max-w-[18rem] min-w-0" aria-expanded={open} onClick={() => setOpen(!open)} title="Saved configurations">
        <Save size={15} className="shrink-0" />
        <span className="truncate max-sm:max-w-[9rem]">{profile.name}</span>
        <ChevronDown size={14} className="shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <ProfileBar profile={profile} />
        </div>
      )}
    </div>
  )
}

function Header({ dark, toggle, showSaved }: { dark: boolean; toggle: () => void; showSaved: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="flex h-14 items-center gap-3 px-4">
        <Logo />
        <span className="flex-1" />
        {showSaved && <SavedMenu />}
        <button type="button" className="btn-secondary h-9 w-9 shrink-0 px-0" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  )
}

/** The views, down the left side; a scrolling row on narrow screens. */
function SideNav({ view }: { view: ViewName }) {
  const tokenCount = useAppState((s) => s.tokenSets.length)
  return (
    <nav
      aria-label="Views"
      className="flex w-full shrink-0 gap-0.5 overflow-x-auto border-b border-zinc-200 bg-white p-2 md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] md:w-52 md:flex-col md:overflow-visible md:border-r md:border-b-0 md:p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setState({ view: t.id })}
          aria-current={view === t.id ? 'page' : undefined}
          className={cx(
            'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap transition',
            view === t.id
              ? 'bg-indigo-50 font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
              : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white',
          )}
        >
          {t.icon}
          <span className="flex-1">{t.label}</span>
          {t.id === 'tokens' && tokenCount > 0 && <span className="rounded-full bg-zinc-200 px-1.5 text-xs text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">{tokenCount}</span>}
        </button>
      ))}
    </nav>
  )
}

export default function App() {
  const [dark, toggle] = useTheme()
  const stored = useAppState((s) => s.view)
  // Compare now lives under Tokens.
  const view: ViewName = stored === 'compare' ? 'tokens' : stored
  const [logout, setLogout] = useState(() => (isCallbackPage() ? undefined : takeLogoutResult()))
  const callbackPage = isCallbackPage()

  useEffect(() => (callbackPage ? undefined : listenForSignInResponses()), [callbackPage])

  if (callbackPage)
    return (
      <>
        <Header dark={dark} toggle={toggle} showSaved={false} />
        <main className="px-4 py-10">
          <ErrorBoundary area="callback page">
            <CallbackView home={BASE} />
          </ErrorBoundary>
        </main>
      </>
    )

  return (
    <>
      <Header dark={dark} toggle={toggle} showSaved />
      <div className="flex flex-col md:flex-row">
        <SideNav view={view} />
        <main className="min-w-0 flex-1 space-y-4 p-4 sm:p-6">
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
          <ErrorBoundary key={view} area={`${TABS.find((n) => n.id === view)?.label ?? 'view'} view`}>
            {view === 'authorize' && <AuthorizeView />}
            {view === 'grants' && <GrantsView />}
            {view === 'tokens' && <TokensView />}
            {view === 'organizations' && (
              <>
                <OrganizationsView />
                <SignInResult organizationsOnly />
              </>
            )}
            {view === 'http' && <HttpLogView />}
          </ErrorBoundary>
        </main>
      </div>
    </>
  )
}
