import { ArrowLeftRight, Building2, CloudDownload, KeyRound, Loader2, LogIn, Plus, Trash2, Zap } from 'lucide-react'
import { useState } from 'react'
import { HttpExchangeView } from '../components/HttpExchangeView'
import { Alert, Badge, Empty, Field, Section, cx } from '../components/ui'
import { switchByTokenExchange } from '../lib/flows'
import { fetchOrganizations, orgEndpoints, organizationOf, switchSubjectToken } from '../lib/oauth/b2b'
import { presetById } from '../lib/oauth/presets'
import type { HttpExchange } from '../lib/oauth/http'
import { type B2BConfig, type Organization, type Profile, type TokenSet } from '../lib/oauth/types'
import { activeProfile, setState, updateProfile, useAppState } from '../lib/store/appStore'
import { RequestPreview, profileProblems } from './AuthorizeView'

function B2BSettings({ profile }: { profile: Profile }) {
  const b2b = profile.b2b
  const preset = presetById(profile.preset)
  const up = (patch: Partial<B2BConfig>) => updateProfile(profile.id, { b2b: { ...b2b, ...patch } })
  return (
    <Section
      title="How this server handles organizations"
      defaultOpen={false}
      subtitle={b2b.style === 'path' ? 'organization in the path' : `parameter ${b2b.paramName}`}
    >
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(['param', 'path'] as const).map((st) => (
          <label key={st} className="flex items-center gap-1.5 text-sm">
            <input type="radio" checked={b2b.style === st} onChange={() => up({ style: st })} />
            {st === 'path' ? 'Organization in the endpoint path' : 'Organization as a request parameter'}
          </label>
        ))}
      </div>
      {b2b.style === 'path' ? (
        <>
          <Field label="Authorization endpoint template" hint="{issuer} and {org} are substituted, for example {issuer}/o/{org}/authorize.">
            <input className="input code" value={b2b.authorizeTemplate} onChange={(e) => up({ authorizeTemplate: e.target.value })} />
          </Field>
          <Field label="Token endpoint template">
            <input className="input code" value={b2b.tokenTemplate} onChange={(e) => up({ tokenTemplate: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={b2b.redeemAtOrgTokenEndpoint} onChange={(e) => up({ redeemAtOrgTokenEndpoint: e.target.checked })} />
            Redeem codes at the organization's token endpoint
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={b2b.refreshAtOrgTokenEndpoint} onChange={(e) => up({ refreshAtOrgTokenEndpoint: e.target.checked })} />
            Refresh at the organization's token endpoint (otherwise at the default one)
          </label>
        </>
      ) : (
        <Field label="Parameter name" hint="Sent on the authorization request, for example organization or org_id.">
          <input className="input code" value={b2b.paramName} onChange={(e) => up({ paramName: e.target.value })} />
        </Field>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Field label="Organization ID claim">
          <input className="input code" value={b2b.orgClaims.id} onChange={(e) => up({ orgClaims: { ...b2b.orgClaims, id: e.target.value } })} />
        </Field>
        <Field label="Name claim">
          <input className="input code" value={b2b.orgClaims.name} onChange={(e) => up({ orgClaims: { ...b2b.orgClaims, name: e.target.value } })} />
        </Field>
        <Field label="Handle claim">
          <input className="input code" value={b2b.orgClaims.handle} onChange={(e) => up({ orgClaims: { ...b2b.orgClaims, handle: e.target.value } })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Switch: subject token" hint="Token response field exchanged when switching.">
          <input
            className="input code"
            list="ap-subject-fields"
            value={b2b.switchExchange.subjectTokenField}
            onChange={(e) => up({ switchExchange: { ...b2b.switchExchange, subjectTokenField: e.target.value } })}
          />
          <datalist id="ap-subject-fields">
            <option value="access_token" />
            <option value="refresh_token" />
            <option value="id_token" />
            <option value="device_secret" />
          </datalist>
        </Field>
        <Field label="Switch: subject_token_type">
          <input
            className="input code"
            list="ap-token-types"
            value={b2b.switchExchange.subjectTokenType}
            onChange={(e) => up({ switchExchange: { ...b2b.switchExchange, subjectTokenType: e.target.value } })}
          />
          <datalist id="ap-token-types">
            <option value="urn:ietf:params:oauth:token-type:access_token" />
            <option value="urn:ietf:params:oauth:token-type:refresh_token" />
            <option value="urn:ietf:params:oauth:token-type:id_token" />
            <option value="urn:ietf:params:oauth:token-type:jwt" />
          </datalist>
        </Field>
      </div>
      <Field label="List my organizations endpoint (optional)" hint="Called with the selected access token. Takes {issuer}.">
        <input className="input code" value={b2b.listTemplate} onChange={(e) => up({ listTemplate: e.target.value })} placeholder="{issuer}/me/organizations" />
      </Field>
      <button type="button" className="btn-ghost text-xs" onClick={() => up({ ...preset.b2b(), organizations: b2b.organizations })}>
        Reset to {preset.name} defaults
      </button>
    </Section>
  )
}

function OrgList({ profile, selected, onSelect, current }: { profile: Profile; selected?: string; onSelect: (id: string) => void; current?: Organization }) {
  const orgs = profile.b2b.organizations
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const setOrgs = (organizations: Organization[]) => updateProfile(profile.id, { b2b: { ...profile.b2b, organizations } })
  return (
    <div className="space-y-2">
      {orgs.length === 0 && <p className="text-sm text-zinc-500">No organizations yet. Add one by ID, or load them with a token.</p>}
      {orgs.map((o) => (
        <div
          key={o.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(o.id)}
          onKeyDown={(e) => e.key === 'Enter' && onSelect(o.id)}
          className={cx(
            'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition',
            selected === o.id ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40' : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800',
          )}
        >
          <Building2 size={16} className="shrink-0 text-zinc-400" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {o.name}
              {current?.id === o.id && <Badge tone="green">current</Badge>}
            </div>
            <div className="code truncate text-[11px] text-zinc-500">
              {o.handle ? `${o.handle} · ` : ''}
              {o.id}
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost px-1.5 hover:text-red-600"
            title="Remove"
            onClick={(e) => {
              e.stopPropagation()
              setOrgs(orgs.filter((x) => x.id !== o.id))
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <input className="input code flex-1" placeholder="Organization ID (OU ID)" value={id} onChange={(e) => setId(e.target.value.trim())} />
        <input className="input w-36" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          type="button"
          className="btn-secondary shrink-0"
          disabled={!id || orgs.some((o) => o.id === id)}
          onClick={() => {
            setOrgs([...orgs, { id, name: name || id }])
            setId('')
            setName('')
          }}
        >
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  )
}

export function OrganizationsView() {
  const profile = useAppState((s) => activeProfile(s))
  const sets = useAppState((s) => s.tokenSets.filter((t) => t.profileId === profile.id))
  const selectedSetId = useAppState((s) => s.selectedTokenSetId)
  const baseSet: TokenSet | undefined = sets.find((s) => s.id === selectedSetId) ?? sets[0]
  const current = baseSet ? organizationOf(baseSet, profile.b2b.orgClaims) : undefined
  const [selectedOrgId, setSelectedOrgId] = useState<string>()
  const org = profile.b2b.organizations.find((o) => o.id === selectedOrgId)
  const [loading, setLoading] = useState(false)
  const [listExchange, setListExchange] = useState<HttpExchange>()
  const [listError, setListError] = useState<string>()
  const [switching, setSwitching] = useState(false)
  const [switchResult, setSwitchResult] = useState<{ ok: boolean; message: string; exchange?: HttpExchange }>()
  const [switchScope, setSwitchScope] = useState('openid')
  const subjectField = profile.b2b.switchExchange.subjectTokenField
  const hasSubject = !!baseSet && !!switchSubjectToken(profile, baseSet)
  const problems = profileProblems(profile)

  const loadOrgs = async () => {
    if (!baseSet?.response.access_token) return
    setLoading(true)
    setListError(undefined)
    try {
      const r = await fetchOrganizations(profile, baseSet.response.access_token)
      setListExchange(r.exchange)
      if (r.error || !r.organizations) setListError(r.error ?? 'No organizations in the response.')
      else {
        const known = new Map(profile.b2b.organizations.map((o) => [o.id, o]))
        for (const o of r.organizations) known.set(o.id, o)
        updateProfile(profile.id, { b2b: { ...profile.b2b, organizations: [...known.values()] } })
      }
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Organizations (B2B)</h2>
        <p className="text-sm text-zinc-500">
          Sign in to a specific organization, switch between organizations, and compare what each token says. Set how this server selects an organization below; presets fill it in for known
          servers.
        </p>
      </div>

      <div className="card overflow-hidden">
        <B2BSettings profile={profile} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-3">
          <div className="card space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Organizations</h3>
              <button type="button" className="btn-secondary text-xs" disabled={!baseSet?.response.access_token || loading} onClick={() => void loadOrgs()} title="Uses the selected token set's access token">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />} Load my organizations
              </button>
            </div>
            {listError && (
              <Alert tone="red">
                Could not list organizations: {listError}
              </Alert>
            )}
            {listExchange && <HttpExchangeView exchange={listExchange} />}
            <OrgList profile={profile} selected={selectedOrgId} onSelect={setSelectedOrgId} current={current} />
          </div>

          <div className="card space-y-2 p-4 text-sm">
            <h3 className="font-semibold">Current context</h3>
            {baseSet ? (
              <>
                <div>
                  Token set: <span className="font-medium">{baseSet.label}</span>
                </div>
                <div>
                  Organization: {current ? <Badge tone="violet">{current.name}</Badge> : <span className="text-zinc-500">none in the token (no {profile.b2b.orgClaims.id || 'organization'} claim)</span>}
                </div>
                <div>
                  Switch subject (<span className="code">{subjectField}</span>): {hasSubject ? <Badge tone="blue">available</Badge> : <span className="text-zinc-500">not in this token set</span>}
                </div>
                <button type="button" className="btn-ghost px-0 text-xs text-indigo-600" onClick={() => setState({ view: 'tokens' })}>
                  Choose another token set in Tokens
                </button>
              </>
            ) : (
              <p className="text-zinc-500">No token set yet. Sign in to an organization to get one.</p>
            )}
          </div>
        </div>

        <div className="card space-y-4 p-4">
          {!org ? (
            <Empty>Select an organization to sign in to it or switch to it.</Empty>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Building2 size={18} className="text-indigo-500" />
                <h3 className="text-base font-semibold">{org.name}</h3>
                {current?.id === org.id && <Badge tone="green">current</Badge>}
              </div>
              {problems.length > 0 ? (
                <Alert tone="blue">{problems.join(' ')}</Alert>
              ) : (
                <>
                  <OrgEndpointsNote profile={profile} org={org} />
                  <div className="space-y-2">
                    <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                      <LogIn size={15} /> Sign in to this organization
                    </h4>
                    <RequestPreview profile={profile} org={org} startLabel={`Sign in to ${org.name}`} />
                  </div>
                  <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                    <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                      <Zap size={15} /> Silent switch (prompt=none)
                    </h4>
                    <p className="text-xs text-zinc-500">
                      Reuses the server's SSO session: no screen is shown if the session can reach this organization; otherwise the server answers login_required. The redirect is full page
                      because many servers refuse to be framed.
                    </p>
                    <RequestPreview profile={profile} org={org} overrides={[['prompt', 'none']]} label={`Silent switch to ${org.name}`} startLabel="Switch silently" />
                  </div>
                  <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                    <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                      <KeyRound size={15} /> Switch by token exchange
                    </h4>
                    <p className="text-xs text-zinc-500">
                      Exchanges the selected set's <span className="code">{subjectField}</span> (RFC 8693) at this organization's token endpoint, with no browser round trip. The client needs the token
                      exchange grant.
                    </p>
                    <div className="flex gap-1.5">
                      <input className="input code flex-1" value={switchScope} onChange={(e) => setSwitchScope(e.target.value)} placeholder="scope" />
                      <button
                        type="button"
                        className="btn-primary shrink-0"
                        disabled={!hasSubject || switching}
                        onClick={() => {
                          if (!baseSet) return
                          setSwitching(true)
                          switchByTokenExchange(baseSet, org, switchScope)
                            .then((g) =>
                              setSwitchResult({
                                ok: !!g.tokens,
                                message: g.tokens ? `New token set for ${org.name}.` : `${g.error?.error}: ${g.error?.error_description ?? ''}`,
                                exchange: g.exchange,
                              }),
                            )
                            .catch((e: unknown) => setSwitchResult({ ok: false, message: e instanceof Error ? e.message : String(e) }))
                            .finally(() => setSwitching(false))
                        }}
                      >
                        {switching ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />} Exchange
                      </button>
                    </div>
                    {!hasSubject && <p className="text-xs text-amber-600">The selected token set has no {subjectField}.</p>}
                    {switchResult && (
                      <div className="space-y-2">
                        <Alert tone={switchResult.ok ? 'green' : 'red'}>
                          {switchResult.message}{' '}
                          {switchResult.ok && (
                            <button type="button" className="underline" onClick={() => setState({ view: 'compare' })}>
                              Compare claims
                            </button>
                          )}
                        </Alert>
                        {switchResult.exchange && <HttpExchangeView exchange={switchResult.exchange} />}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function OrgEndpointsNote({ profile, org }: { profile: Profile; org: Organization }) {
  let ep: ReturnType<typeof orgEndpoints> | undefined
  let error: string | undefined
  try {
    ep = orgEndpoints(profile, org)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  if (!ep) return <Alert tone="amber">{error}</Alert>
  return (
    <div className="rounded-lg bg-zinc-50 p-2.5 text-xs dark:bg-zinc-950">
      <div>
        <span className="text-zinc-500">authorize</span> <span className="code break-all">{ep.authorization}</span>
      </div>
      <div>
        <span className="text-zinc-500">token</span> <span className="code break-all">{ep.token}</span>
      </div>
    </div>
  )
}
