import { Check, ChevronDown, Plus, Settings2, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AUTH_METHOD_LABELS, addClient, updateClient } from '../lib/clients'
import type { ClientAuthMethod, ClientConfig, Profile } from '../lib/oauth/types'
import { clientSecretOf, setClientSecret, updateProfile, useAppState } from '../lib/store/appStore'
import { Field, SecretInput, cx } from './ui'

/** A client's name, ID, authentication method and secret (the secret in memory only). */
export function ClientEditor({ profile, client, onRemove, compact = false }: { profile: Profile; client: ClientConfig; onRemove?: () => void; compact?: boolean }) {
  const secret = useAppState((s) => clientSecretOf(profile.id, client.id, s))
  const set = (patch: Partial<ClientConfig>) => updateClient(profile, client.id, patch)
  return (
    <div className={cx('grid items-end gap-3', compact ? 'md:grid-cols-[1.2fr_2fr_1.5fr_2fr]' : 'md:grid-cols-[1.2fr_2fr_1.5fr_2fr_auto]')}>
      <Field label="Name">
        <input className="input" value={client.name} onChange={(e) => set({ name: e.target.value })} aria-label="Client name" />
      </Field>
      <Field label="Client ID">
        <input className="input code" value={client.clientId} spellCheck={false} onChange={(e) => set({ clientId: e.target.value })} aria-label={`Client ID of ${client.name}`} />
      </Field>
      <Field label="Authentication">
        <select className="input" value={client.authMethod} onChange={(e) => set({ authMethod: e.target.value as ClientAuthMethod })} aria-label={`Authentication of ${client.name}`}>
          {(Object.keys(AUTH_METHOD_LABELS) as ClientAuthMethod[]).map((m) => (
            <option key={m} value={m}>
              {AUTH_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </Field>
      {client.authMethod !== 'none' ? (
        <Field label="Client secret">
          <SecretInput value={secret} onChange={(v) => setClientSecret(profile.id, client.id, v)} />
        </Field>
      ) : (
        <span className="pb-2 text-xs text-zinc-500">No secret: a public client.</span>
      )}
      {!compact && (
        <button
          type="button"
          className="btn-ghost mb-0.5 px-2 hover:text-red-600 disabled:opacity-30"
          disabled={!onRemove}
          title={onRemove ? `Remove ${client.name}` : 'A configuration keeps at least one client'}
          aria-label={`Remove ${client.name}`}
          onClick={onRemove}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  )
}

/** Closes a pop-over on a click outside it or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return box
}

const typeLabel = (m: ClientAuthMethod) => (m === 'none' ? 'public' : m.replace('client_', ''))

/** A short form for a new client: name, client ID, whether it has a secret, and the secret. */
function NewClientForm({ profile, onDone }: { profile: Profile; onDone: (id?: string) => void }) {
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [confidential, setConfidential] = useState(false)
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string>()
  const add = () => {
    if (!clientId.trim()) return setError('Enter the client ID.')
    const id = addClient(profile, { clientId: clientId.trim(), authMethod: confidential ? 'client_secret_post' : 'none', ...(name.trim() ? { name: name.trim() } : {}) })
    if (confidential && secret) setClientSecret(profile.id, id, secret)
    onDone(id)
  }
  return (
    <div
      role="dialog"
      aria-label="New client"
      className="w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && add()}
    >
      <div className="font-semibold">New client</div>
      <Field label="Name">
        <input className="input" autoFocus value={name} placeholder={`Client ${profile.clients.length + 1}`} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Client ID">
        <input
          className="input code"
          value={clientId}
          spellCheck={false}
          onChange={(e) => {
            setClientId(e.target.value)
            setError(undefined)
          }}
        />
      </Field>
      <div role="radiogroup" aria-label="Client type" className="grid grid-cols-2 gap-1.5">
        {[false, true].map((c) => (
          <button
            key={String(c)}
            type="button"
            role="radio"
            aria-checked={confidential === c}
            className={cx(
              'rounded-lg border py-1.5 text-[13px]',
              confidential === c ? 'border-indigo-500 bg-indigo-50 font-medium text-indigo-800 ring-1 ring-indigo-500 dark:bg-indigo-950 dark:text-indigo-200' : 'border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300',
            )}
            onClick={() => setConfidential(c)}
          >
            {c ? 'Has a secret' : 'Public'}
          </button>
        ))}
      </div>
      {confidential && (
        <Field label="Client secret (memory only)">
          <SecretInput value={secret} onChange={setSecret} />
        </Field>
      )}
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost text-[13px]" onClick={() => onDone()}>
          Cancel
        </button>
        <button type="button" className="btn-primary text-[13px]" onClick={add}>
          Add and use
        </button>
      </div>
    </div>
  )
}

/** The sign-in client: a plain Client ID field while there is one client, a picker once there are
 * more. Both can add a client; the picker also opens client management. */
export function ClientPicker({ profile, onManage }: { profile: Profile; onManage: () => void }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const box = useDismiss(open || adding, () => {
    setOpen(false)
    setAdding(false)
  })
  const chosen = profile.clients.find((c) => c.id === profile.signInClient) ?? profile.clients[0]
  const finish = (id?: string) => {
    setAdding(false)
    if (id) updateProfile(profile.id, { signInClient: id })
  }

  return (
    <div ref={box} className="relative">
      {profile.clients.length === 1 ? (
        <>
          <label htmlFor="f-client-id" className="label">
            Client ID
          </label>
          <input id="f-client-id" className="input code" value={profile.clientId} spellCheck={false} placeholder="The client registered for this playground" onChange={(e) => updateProfile(profile.id, { clientId: e.target.value })} />
          <button type="button" className="mt-1 text-xs text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => setAdding(!adding)}>
            + Add another client
          </button>
        </>
      ) : (
        <>
          <span className="label">Client</span>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cx('input flex h-auto items-center gap-2 py-1.5 text-left', open && 'border-indigo-500 ring-2 ring-indigo-500/20')}
            onClick={() => {
              setAdding(false)
              setOpen(!open)
            }}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{chosen.name}</span>
              <span className="code block truncate text-[11px] text-zinc-500">{chosen.clientId || '(no client ID)'}</span>
            </span>
            <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{typeLabel(chosen.authMethod)}</span>
            <ChevronDown size={14} className="shrink-0 text-zinc-500" />
          </button>
          {open && (
            <div role="listbox" aria-label="Clients" className="absolute right-0 left-0 z-30 mt-1 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
              {profile.clients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={c.id === chosen.id}
                  className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800', c.id === chosen.id && 'bg-zinc-100 dark:bg-zinc-800')}
                  onClick={() => {
                    updateProfile(profile.id, { signInClient: c.id })
                    setOpen(false)
                  }}
                >
                  <span className="w-4 shrink-0 text-indigo-600 dark:text-indigo-400">{c.id === chosen.id && <Check size={14} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{c.name}</span>
                    <span className="code block truncate text-[11px] text-zinc-500">{c.clientId || '(no client ID)'}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-500">{typeLabel(c.authMethod)}</span>
                </button>
              ))}
              <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-indigo-700 hover:bg-zinc-100 dark:text-indigo-300 dark:hover:bg-zinc-800"
                onClick={() => {
                  setOpen(false)
                  setAdding(true)
                }}
              >
                <Plus size={14} className="w-4" /> New client…
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                onClick={() => {
                  setOpen(false)
                  onManage()
                }}
              >
                <Settings2 size={14} className="w-4" /> Manage clients
              </button>
            </div>
          )}
        </>
      )}
      {adding && (
        <div className="absolute right-0 z-30 mt-1">
          <NewClientForm profile={profile} onDone={finish} />
        </div>
      )}
    </div>
  )
}
