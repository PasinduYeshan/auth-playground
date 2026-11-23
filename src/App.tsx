import { ChevronDown, Moon, Save, Sun, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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

const TABS: { id: ViewName; label: string }[] = [
  { id: 'authorize', label: 'Sign in' },
  { id: 'grants', label: 'Other grants' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'http', label: 'HTTP log' },
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

function Header({ dark, toggle, view }: { dark: boolean; toggle: () => void; view?: ViewName }) {
  const tokenCount = useAppState((s) => s.tokenSets.length)
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:h-14 md:flex-nowrap md:py-0">
        <Logo />
        {view && (
          <nav aria-label="Views" className="order-last -mx-1 flex w-full min-w-0 gap-0.5 overflow-x-auto md:order-none md:mx-0 md:w-auto md:flex-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setState({ view: t.id })}
                aria-current={view === t.id ? 'page' : undefined}
                className={cx(
                  'shrink-0 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition',
                  view === t.id ? 'bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900',
                )}
              >
                {t.label}
                {t.id === 'tokens' && tokenCount > 0 && <span className="ml-1.5 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-700">{tokenCount}</span>}
              </button>
            ))}
          </nav>
        )}
        <span className={cx('flex-1', view && 'md:hidden')} />
        {view && <SavedMenu />}
        <button type="button" className="btn-secondary h-9 w-9 shrink-0 px-0" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
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
        <Header dark={dark} toggle={toggle} />
        <main className="px-4 py-10">
          <ErrorBoundary area="callback page">
            <CallbackView home={BASE} />
          </ErrorBoundary>
        </main>
      </>
    )

  return (
    <>
      <Header dark={dark} toggle={toggle} view={view} />
      <main className="mx-auto max-w-7xl min-w-0 space-y-4 p-4 sm:p-6">
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
              <SignInResult />
            </>
          )}
          {view === 'http' && <HttpLogView />}
        </ErrorBoundary>
      </main>
    </>
  )
}
