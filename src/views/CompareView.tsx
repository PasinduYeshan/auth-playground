import { useState } from 'react'
import { Badge, Empty, Field, cx } from '../components/ui'
import { diffClaims, isVolatileClaim, organizationOf, type DiffStatus } from '../lib/oauth/b2b'
import { decodeToken } from '../lib/oauth/jwt'
import type { TokenSet } from '../lib/oauth/types'
import { useAppState } from '../lib/store/appStore'

type Which = 'access_token' | 'id_token'

function claimsOf(set: TokenSet | undefined, which: Which): Record<string, unknown> | undefined {
  const raw = set?.response[which]
  if (!raw) return undefined
  const d = decodeToken(raw)
  return d.kind === 'jwt' ? d.payload : undefined
}

const rowTone: Record<DiffStatus, string> = {
  same: '',
  changed: 'bg-amber-50 dark:bg-amber-950/30',
  added: 'bg-emerald-50 dark:bg-emerald-950/30',
  removed: 'bg-red-50 dark:bg-red-950/30',
}

const fmt = (v: unknown) => (v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

function SetPicker({ sets, value, onChange, label }: { sets: TokenSet[]; value?: string; onChange: (id: string) => void; label: string }) {
  const profiles = useAppState((s) => s.profiles)
  return (
    <Field label={label}>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {sets.map((s) => {
          const org = organizationOf(s, profiles.find((p) => p.id === s.profileId)?.b2b.orgClaims)
          return (
            <option key={s.id} value={s.id}>
              {s.label}
              {org ? ` · ${org.name}` : ''} · {new Date(s.obtainedAt).toLocaleTimeString()}
            </option>
          )
        })}
      </select>
    </Field>
  )
}

export function CompareView() {
  const sets = useAppState((s) => s.tokenSets)
  const [leftId, setLeftId] = useState<string>()
  const [rightId, setRightId] = useState<string>()
  const [which, setWhich] = useState<Which>('access_token')
  const [hideVolatile, setHideVolatile] = useState(true)
  const [onlyDiff, setOnlyDiff] = useState(false)

  if (sets.length < 2) return <Empty>Get at least two token sets (for example, sign in to two organizations) to compare their claims.</Empty>

  const left = sets.find((s) => s.id === leftId) ?? sets[1]
  const right = sets.find((s) => s.id === rightId) ?? sets[0]
  const l = claimsOf(left, which)
  const r = claimsOf(right, which)
  const rows = l && r ? diffClaims(l, r).filter((row) => !(hideVolatile && isVolatileClaim(row.claim)) && !(onlyDiff && row.status === 'same')) : []
  const counts = l && r ? diffClaims(l, r).reduce<Record<string, number>>((acc, x) => ({ ...acc, [x.status]: (acc[x.status] ?? 0) + 1 }), {}) : {}

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Compare token claims</h2>
        <p className="text-sm text-zinc-500">See what changes between organizations, after a refresh, or with different scopes and resources.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_180px]">
        <SetPicker sets={sets} value={left.id} onChange={setLeftId} label="Left" />
        <SetPicker sets={sets} value={right.id} onChange={setRightId} label="Right" />
        <Field label="Token">
          <select className="input" value={which} onChange={(e) => setWhich(e.target.value as Which)}>
            <option value="access_token">Access token</option>
            <option value="id_token">ID token</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={hideVolatile} onChange={(e) => setHideVolatile(e.target.checked)} /> Hide per-token claims (exp, iat, jti…)
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Only differences
        </label>
        <span className="flex gap-1">
          {counts.changed ? <Badge tone="amber">{counts.changed} changed</Badge> : null}
          {counts.added ? <Badge tone="green">{counts.added} only right</Badge> : null}
          {counts.removed ? <Badge tone="red">{counts.removed} only left</Badge> : null}
        </span>
      </div>
      {!l || !r ? (
        <Empty>One of the sets has no decodable {which.replace('_', ' ')}.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">Claim</th>
                <th className="px-3 py-2">Left</th>
                <th className="px-3 py-2">Right</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.claim} className={cx('border-t border-zinc-100 align-top dark:border-zinc-800', rowTone[row.status])}>
                  <td className="code px-3 py-1.5 font-semibold text-indigo-600 dark:text-indigo-400">{row.claim}</td>
                  <td className="code px-3 py-1.5 break-all">{fmt(row.left)}</td>
                  <td className="code px-3 py-1.5 break-all">{fmt(row.right)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
