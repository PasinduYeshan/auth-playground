import { CheckCircle2, CircleAlert, Info, ShieldAlert, ShieldCheck, ShieldQuestion, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { checkAccessTokenClaims, checkIdTokenClaims, decodeToken, formatEpoch, verifySignature, type ClaimCheck, type Jwks, type SignatureResult } from '../lib/oauth/jwt'
import { Badge, CopyButton, JsonView, Tabs, cx } from './ui'

const CLAIM_DOCS: Record<string, string> = {
  iss: 'Issuer',
  sub: 'Subject (user or client ID)',
  aud: 'Audience',
  exp: 'Expires at',
  nbf: 'Not before',
  iat: 'Issued at',
  auth_time: 'Time of authentication',
  jti: 'Token ID',
  nonce: 'Nonce from the authorization request',
  azp: 'Authorized party',
  at_hash: 'Access token hash',
  c_hash: 'Code hash',
  acr: 'Authentication context class',
  amr: 'Authentication methods',
  sid: 'Session ID',
  scope: 'Granted scopes',
  client_id: 'Client the token was issued to',
  grant_type: 'Grant that issued the token',
  cnf: 'Confirmation (key binding, e.g. DPoP)',
  act: 'Actor (delegation)',
  ouId: 'Organization unit ID (ThunderID)',
  ouName: 'Organization unit name (ThunderID)',
  ouHandle: 'Organization unit handle (ThunderID)',
  roles: 'Roles in the organization',
  groups: 'Groups',
  aci: 'Authorization context ID (ThunderID)',
  tfid: 'Token family ID (ThunderID)',
  alg: 'Signing algorithm',
  kid: 'Key ID',
  typ: 'Token type',
}

const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat', 'auth_time', 'updated_at'])

export function relativeTime(epochSeconds: number): string {
  const diff = epochSeconds - Date.now() / 1000
  const abs = Math.abs(diff)
  const unit = abs < 90 ? `${Math.round(abs)} s` : abs < 5400 ? `${Math.round(abs / 60)} min` : abs < 172800 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86400)} d`
  return diff >= 0 ? `in ${unit}` : `${unit} ago`
}

function ClaimsTable({ claims }: { claims: Record<string, unknown> }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {Object.entries(claims).map(([k, v]) => (
          <tr key={k} className="border-t border-zinc-100 align-top first:border-t-0 dark:border-zinc-800">
            <td className="w-44 py-1.5 pr-3">
              <div className="code font-semibold text-indigo-600 dark:text-indigo-400">{k}</div>
              {CLAIM_DOCS[k] && <div className="text-[11px] text-zinc-500">{CLAIM_DOCS[k]}</div>}
            </td>
            <td className="code py-1.5 break-all">
              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              {TIME_CLAIMS.has(k) && typeof v === 'number' && (
                <div className="font-sans text-[11px] text-zinc-500">
                  {formatEpoch(v)} · {relativeTime(v)}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const checkIcon = {
  pass: <CheckCircle2 size={15} className="text-emerald-500" />,
  fail: <XCircle size={15} className="text-red-500" />,
  warn: <CircleAlert size={15} className="text-amber-500" />,
  info: <Info size={15} className="text-sky-500" />,
}

export function ChecksList({ signature, checks }: { signature?: SignatureResult; checks: ClaimCheck[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {signature && (
        <li className="flex items-start gap-2">
          {signature.status === 'valid' ? (
            <ShieldCheck size={15} className="mt-0.5 text-emerald-500" />
          ) : signature.status === 'invalid' ? (
            <ShieldAlert size={15} className="mt-0.5 text-red-500" />
          ) : (
            <ShieldQuestion size={15} className="mt-0.5 text-zinc-400" />
          )}
          <span>
            <span className="font-medium">Signature</span> <span className="text-zinc-600 dark:text-zinc-400">{signature.detail}</span>
          </span>
        </li>
      )}
      {checks.map((c) => (
        <li key={c.name} className="flex items-start gap-2">
          <span className="mt-0.5">{checkIcon[c.status]}</span>
          <span>
            <span className="code font-medium">{c.name}</span> <span className="text-zinc-600 dark:text-zinc-400">{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export interface TokenViewerProps {
  token: string
  kind: 'access' | 'id' | 'refresh' | 'other'
  jwks?: Jwks
  issuer?: string
  clientId?: string
  nonce?: string
  accessToken?: string
  code?: string
}

export function TokenViewer(props: TokenViewerProps) {
  const { token, kind, jwks, issuer, clientId, nonce, accessToken, code } = props
  const decoded = decodeToken(token)
  const [tab, setTab] = useState<'claims' | 'json' | 'raw'>('claims')
  const [signature, setSignature] = useState<SignatureResult>()
  const [checks, setChecks] = useState<ClaimCheck[]>([])

  useEffect(() => {
    let cancelled = false
    const d = decodeToken(token)
    void (async () => {
      const sig = await verifySignature(d, jwks)
      const c =
        kind === 'id'
          ? await checkIdTokenClaims(d, { issuer, audience: clientId, nonce, accessToken, code })
          : kind === 'access'
            ? checkAccessTokenClaims(d, issuer)
            : checkAccessTokenClaims(d, issuer).filter((x) => x.name !== 'aud')
      if (!cancelled) {
        setSignature(sig)
        setChecks(c)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, kind, jwks, issuer, clientId, nonce, accessToken, code])

  if (decoded.kind === 'opaque')
    return (
      <div className="space-y-2">
        <Badge>opaque</Badge>
        <p className="text-sm text-zinc-500">Not a JWT. Use introspection to learn about this token.</p>
        <TokenRaw token={token} />
      </div>
    )
  if (decoded.kind === 'jwe')
    return (
      <div className="space-y-2">
        <Badge tone="violet">encrypted (JWE)</Badge>
        <JsonView value={decoded.header} />
        <p className="text-sm text-zinc-500">The payload is encrypted for the client; it cannot be read without the client's private key.</p>
        <TokenRaw token={token} />
      </div>
    )

  const typ = String(decoded.header.typ ?? '')
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="blue">{String(decoded.header.alg)}</Badge>
        {typ && <Badge tone="violet">{typ}</Badge>}
        {decoded.header.kid !== undefined && <Badge>kid {String(decoded.header.kid).slice(0, 16)}</Badge>}
        {signature && (
          <Badge tone={signature.status === 'valid' ? 'green' : signature.status === 'invalid' ? 'red' : 'neutral'}>
            {signature.status === 'valid' ? 'signature valid' : signature.status === 'invalid' ? 'signature invalid' : 'signature not checked'}
          </Badge>
        )}
        <span className="flex-1" />
        <CopyButton value={token} label="Copy" />
      </div>
      <ChecksList signature={signature} checks={checks} />
      <Tabs
        tabs={[
          { id: 'claims', label: 'Claims' },
          { id: 'json', label: 'Header & payload' },
          { id: 'raw', label: 'Encoded' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'claims' && <ClaimsTable claims={decoded.payload} />}
      {tab === 'json' && (
        <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
          <JsonView value={decoded.header} />
          <JsonView value={decoded.payload} />
        </div>
      )}
      {tab === 'raw' && <TokenRaw token={token} />}
    </div>
  )
}

export function TokenRaw({ token }: { token: string }) {
  const parts = token.split('.')
  const colors = ['text-rose-600 dark:text-rose-400', 'text-violet-600 dark:text-violet-400', 'text-sky-600 dark:text-sky-400', 'text-amber-600', 'text-emerald-600']
  return (
    <pre className="code rounded-lg bg-zinc-50 p-3 break-all whitespace-pre-wrap dark:bg-zinc-950">
      {parts.map((p, i) => (
        <span key={i}>
          <span className={cx(colors[i % colors.length])}>{p}</span>
          {i < parts.length - 1 && <span className="text-zinc-400">.</span>}
        </span>
      ))}
    </pre>
  )
}
