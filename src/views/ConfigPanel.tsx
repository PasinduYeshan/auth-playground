import { Copy, Download, FilePlus2, Loader2, Radar, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { KeyValueEditor } from '../components/KeyValueEditor'
import { Alert, Badge, Field, SecretInput, Section, cx } from '../components/ui'
import { runDiscovery } from '../lib/flows'
import { PRESETS, presetById } from '../lib/oauth/presets'
import { defaultRedirectUri, newProfile, type ClientAuthMethod, type Endpoints, type Profile } from '../lib/oauth/types'
import { activeProfile, addProfile, deleteProfile, secretsFor, setSecrets, setState, updateProfile, useAppState } from '../lib/store/appStore'
import { exportProfile, importProfile } from '../lib/store/profiles'

const AUTH_METHODS: { id: ClientAuthMethod; label: string }[] = [
  { id: 'none', label: 'none (public client)' },
  { id: 'client_secret_post', label: 'client_secret_post' },
  { id: 'client_secret_basic', label: 'client_secret_basic' },
]

const ENDPOINT_LABELS: [keyof Endpoints, string][] = [
  ['authorization', 'Authorization'],
  ['token', 'Token'],
  ['userinfo', 'UserInfo'],
  ['introspection', 'Introspection'],
  ['revocation', 'Revocation'],
  ['jwks', 'JWKS URI'],
  ['endSession', 'End session (logout)'],
]

function ProfileBar({ profile }: { profile: Profile }) {
  const profiles = useAppState((s) => s.profiles)
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-2 border-b border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center gap-1.5">
        <select className="input flex-1 font-medium" value={profile.id} onChange={(e) => setState({ activeProfileId: e.target.value })}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn-ghost px-2" title="New configuration" onClick={() => addProfile(newProfile())}>
          <FilePlus2 size={16} />
        </button>
        <button
          type="button"
          className="btn-ghost px-2"
          title="Duplicate"
          onClick={() => addProfile({ ...structuredClone(profile), id: crypto.randomUUID(), name: `${profile.name} (copy)`, updatedAt: Date.now() })}
        >
          <Copy size={16} />
        </button>
        <button
          type="button"
          className="btn-ghost px-2"
          title="Copy as JSON (no secrets)"
          onClick={() => void navigator.clipboard.writeText(exportProfile(profile)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) })}
        >
          <Download size={16} className={cx(copied && 'text-emerald-500')} />
        </button>
        <button type="button" className="btn-ghost px-2" title="Import from JSON" onClick={() => setImporting(!importing)}>
          <Upload size={16} />
        </button>
        <button
          type="button"
          className="btn-ghost px-2 hover:text-red-600"
          title="Delete configuration"
          onClick={() => {
            if (confirm(`Delete "${profile.name}"? This cannot be undone.`)) deleteProfile(profile.id)
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
      <input className="input" value={profile.name} onChange={(e) => updateProfile(profile.id, { name: e.target.value })} aria-label="Configuration name" />
      {importing && (
        <div className="space-y-1.5">
          <textarea className="input code h-28" placeholder="Paste a configuration exported from Auth Playground" value={importText} onChange={(e) => setImportText(e.target.value)} />
          {importError && <div className="text-xs text-red-600">{importError}</div>}
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={() => {
              try {
                addProfile(importProfile(importText))
                setImporting(false)
                setImportText('')
                setImportError('')
              } catch (e) {
                setImportError(e instanceof Error ? e.message : 'Invalid JSON')
              }
            }}
          >
            Import
          </button>
        </div>
      )}
      <p className="text-[11px] text-zinc-500">Saved in this browser. Client secrets are never saved.</p>
    </div>
  )
}

function ScopeChips({ profile }: { profile: Profile }) {
  const discovered = useAppState((s) => s.metadata[profile.id]?.scopes_supported)
  const extra = presetById(profile.preset).extraScopes
  const supported = discovered?.length ? [...new Set([...discovered, ...extra])] : undefined
  if (!supported?.length) return null
  const current = new Set(profile.scope.split(/\s+/).filter(Boolean))
  return (
    <div className="flex flex-wrap gap-1">
      {supported.map((sc) => {
        const on = current.has(sc)
        return (
          <button
            type="button"
            key={sc}
            onClick={() => {
              const next = new Set(current)
              if (on) next.delete(sc)
              else next.add(sc)
              updateProfile(profile.id, { scope: [...next].join(' ') })
            }}
            className={cx(
              'rounded-full border px-2 py-0.5 text-[11px] transition',
              on ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400',
            )}
          >
            {sc}
          </button>
        )
      })}
    </div>
  )
}

export function ConfigPanel() {
  const profile = useAppState((s) => activeProfile(s))
  const secrets = useAppState((s) => secretsFor(profile.id, s))
  const metadata = useAppState((s) => s.metadata[profile.id])
  const [discovering, setDiscovering] = useState(false)
  const [discoveryMsg, setDiscoveryMsg] = useState<{ tone: 'green' | 'red' | 'amber'; text: string }>()
  const up = (patch: Partial<Profile>) => updateProfile(profile.id, patch)
  const preset = presetById(profile.preset)

  const doDiscover = async () => {
    if (!profile.issuer) return
    setDiscovering(true)
    setDiscoveryMsg(undefined)
    try {
      const r = await runDiscovery(profile)
      if (r.error) setDiscoveryMsg({ tone: 'red', text: `Discovery failed: ${r.error}. See the HTTP log.` })
      else setDiscoveryMsg({ tone: r.warnings.length ? 'amber' : 'green', text: r.warnings.length ? r.warnings.join(' ') : 'Endpoints loaded from discovery.' })
    } catch (e) {
      setDiscoveryMsg({ tone: 'red', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setDiscovering(false)
    }
  }

  const supportsMethod = (m: ClientAuthMethod) => !metadata?.token_endpoint_auth_methods_supported || metadata.token_endpoint_auth_methods_supported.includes(m)

  return (
    <div>
      <ProfileBar profile={profile} />

      <Section title="Provider" subtitle={metadata ? <Badge tone="green">discovered</Badge> : undefined}>
        <Field label="Provider" hint="A preset fills defaults for a known server. Every value stays editable.">
          <select
            className="input"
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
        </Field>
        <Field label="Issuer / base URL" hint={preset.issuerHint}>
          <div className="flex gap-1.5">
            <input
              className="input code"
              value={profile.issuer}
              placeholder={preset.issuerPlaceholder}
              onChange={(e) => up({ issuer: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && void doDiscover()}
            />
            <button type="button" className="btn-primary shrink-0" onClick={() => void doDiscover()} disabled={!profile.issuer || discovering}>
              {discovering ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />}
              Discover
            </button>
          </div>
        </Field>
        {discoveryMsg && <Alert tone={discoveryMsg.tone}>{discoveryMsg.text}</Alert>}
        {preset.notes.length > 0 && (
          <details className="rounded-lg bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-950">
            <summary className="cursor-pointer font-medium text-zinc-600 select-none dark:text-zinc-400">Notes for {preset.name}</summary>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-zinc-600 dark:text-zinc-400">
              {preset.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        )}
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-zinc-600 select-none dark:text-zinc-400">Endpoints</summary>
          <div className="mt-2 space-y-2">
            {ENDPOINT_LABELS.map(([key, label]) => (
              <Field key={key} label={label}>
                <input className="input code" value={profile.endpoints[key]} onChange={(e) => up({ endpoints: { ...profile.endpoints, [key]: e.target.value } })} />
              </Field>
            ))}
          </div>
        </details>
      </Section>

      <Section title="Client">
        <Field label="Client ID">
          <input className="input code" value={profile.clientId} onChange={(e) => up({ clientId: e.target.value })} placeholder="auth-playground" />
        </Field>
        <Field label="Client authentication">
          <select className="input" value={profile.clientAuthMethod} onChange={(e) => up({ clientAuthMethod: e.target.value as ClientAuthMethod })}>
            {AUTH_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {supportsMethod(m.id) ? '' : ' (not advertised)'}
              </option>
            ))}
          </select>
        </Field>
        {profile.clientAuthMethod !== 'none' && (
          <>
            <Field label="Client secret" hint="Kept in memory for this tab only. Never saved or exported.">
              <SecretInput value={secrets.clientSecret} onChange={(v) => setSecrets(profile.id, { clientSecret: v })} />
            </Field>
            <Alert tone="amber">
              A secret in a browser is for testing only. Use a test client, never a production one.
              {profile.clientAuthMethod === 'client_secret_basic' &&
                ' client_secret_basic sends an Authorization header, which needs a CORS preflight. If the token endpoint does not answer preflight, use client_secret_post.'}
            </Alert>
          </>
        )}
      </Section>

      <Section title="Authorization request">
        <Field label="Redirect URI" hint="Register this exact value on the client.">
          <div className="flex gap-1.5">
            <input className="input code" value={profile.redirectUri} onChange={(e) => up({ redirectUri: e.target.value })} />
            {profile.redirectUri !== defaultRedirectUri() && (
              <button type="button" className="btn-secondary shrink-0 text-xs" onClick={() => up({ redirectUri: defaultRedirectUri() })} title="Use this site's callback page">
                Reset
              </button>
            )}
          </div>
        </Field>
        <Field label="Scope">
          <input className="input code" value={profile.scope} onChange={(e) => up({ scope: e.target.value })} />
        </Field>
        <ScopeChips profile={profile} />
        <Field label="Resource indicators (RFC 8707)" hint="One per line. All are sent on the authorization request; the first on the token request.">
          <textarea
            className="input code h-16"
            value={profile.resources.join('\n')}
            onChange={(e) => up({ resources: e.target.value.split('\n') })}
            onBlur={() => up({ resources: profile.resources.map((r) => r.trim()).filter(Boolean) })}
            placeholder="https://api.example.com"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="PKCE method">
            <select className="input" value={profile.pkceMethod} onChange={(e) => up({ pkceMethod: e.target.value as Profile['pkceMethod'] })}>
              <option value="S256">S256</option>
              <option value="plain">plain (insecure)</option>
            </select>
          </Field>
          <Field label="Response mode">
            <select className="input" value={profile.responseMode} onChange={(e) => up({ responseMode: e.target.value as Profile['responseMode'] })}>
              <option value="">(default)</option>
              <option value="query">query</option>
              <option value="fragment">fragment</option>
              <option value="form_post">form_post</option>
            </select>
          </Field>
          <Field label="prompt">
            <select className="input" value={profile.prompt} onChange={(e) => up({ prompt: e.target.value })}>
              <option value="">(none sent)</option>
              <option value="login">login</option>
              <option value="none">none</option>
              <option value="consent">consent</option>
              <option value="select_account">select_account</option>
            </select>
          </Field>
          <Field label="max_age (s)">
            <input className="input code" value={profile.maxAge} onChange={(e) => up({ maxAge: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="login_hint">
            <input className="input code" value={profile.loginHint} onChange={(e) => up({ loginHint: e.target.value })} />
          </Field>
          <Field label="acr_values">
            <input className="input code" value={profile.acrValues} onChange={(e) => up({ acrValues: e.target.value })} />
          </Field>
          <Field label="ui_locales">
            <input className="input code" value={profile.uiLocales} onChange={(e) => up({ uiLocales: e.target.value })} />
          </Field>
          <label className="mt-5 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={profile.useNonce} onChange={(e) => up({ useNonce: e.target.checked })} /> Send nonce
          </label>
        </div>
        {profile.pkceMethod === 'plain' && <Alert tone="amber">plain PKCE gives no protection if the request is observed. Many servers refuse it.</Alert>}
        {profile.responseMode === 'form_post' && (
          <Alert tone="red">form_post sends the response as a POST, which a static site cannot receive. The callback will not see the code.</Alert>
        )}
        <Field label="Extra authorization parameters" hint="For example claims, display, id_token_hint, authorization_details or vendor parameters.">
          <KeyValueEditor value={profile.extraAuthParams} onChange={(v) => up({ extraAuthParams: v })} />
        </Field>
      </Section>

      <Section title="Token request" defaultOpen={false}>
        <Field label="Extra token request parameters">
          <KeyValueEditor value={profile.extraTokenParams} onChange={(v) => up({ extraTokenParams: v })} />
        </Field>
      </Section>

      <Section title="Introspection client" defaultOpen={false} subtitle="optional">
        <p className="text-xs text-zinc-500">Leave empty to introspect with the client above. Some servers accept public clients; others need a confidential one.</p>
        <Field label="Client ID">
          <input className="input code" value={profile.introspectionClientId} onChange={(e) => up({ introspectionClientId: e.target.value })} />
        </Field>
        {profile.introspectionClientId && (
          <>
            <Field label="Client authentication">
              <select className="input" value={profile.introspectionAuthMethod} onChange={(e) => up({ introspectionAuthMethod: e.target.value as ClientAuthMethod })}>
                {AUTH_METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            {profile.introspectionAuthMethod !== 'none' && (
              <Field label="Client secret" hint="Memory only.">
                <SecretInput value={secrets.introspectionClientSecret} onChange={(v) => setSecrets(profile.id, { introspectionClientSecret: v })} />
              </Field>
            )}
          </>
        )}
      </Section>
    </div>
  )
}
