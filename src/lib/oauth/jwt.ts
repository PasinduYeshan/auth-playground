// JWT decoding and verification with Web Crypto. Decoding never implies trust: signature and claim
// checks are separate results the UI shows next to the decoded token.
import { base64UrlDecode, base64UrlDecodeToString, base64UrlEncode } from './encoding'

export type JsonObject = Record<string, unknown>

export type DecodedToken =
  | { kind: 'jwt'; header: JsonObject; payload: JsonObject; signature: string; signingInput: string; raw: string }
  | { kind: 'jwe'; header: JsonObject; raw: string }
  | { kind: 'opaque'; raw: string }

export function decodeToken(raw: string): DecodedToken {
  const parts = raw.trim().split('.')
  try {
    if (parts.length === 3) {
      const header = JSON.parse(base64UrlDecodeToString(parts[0])) as JsonObject
      const payload = JSON.parse(base64UrlDecodeToString(parts[1])) as JsonObject
      return { kind: 'jwt', header, payload, signature: parts[2], signingInput: `${parts[0]}.${parts[1]}`, raw }
    }
    if (parts.length === 5) {
      const header = JSON.parse(base64UrlDecodeToString(parts[0])) as JsonObject
      return { kind: 'jwe', header, raw }
    }
  } catch {
    // fall through: not a JWT
  }
  return { kind: 'opaque', raw }
}

export interface Jwk extends JsonWebKey {
  kid?: string
  alg?: string
  use?: string
}

export interface Jwks {
  keys: Jwk[]
}

interface AlgParams {
  importParams: RsaHashedImportParams | EcKeyImportParams | Algorithm
  verifyParams: AlgorithmIdentifier | RsaPssParams | EcdsaParams
  hash: string
}

function algParams(alg: string): AlgParams | undefined {
  const sha = (n: string) => `SHA-${n}`
  const m = /^(RS|PS|ES)(256|384|512)$/.exec(alg)
  if (m) {
    const [, family, bits] = m
    const hash = sha(bits)
    if (family === 'RS')
      return { importParams: { name: 'RSASSA-PKCS1-v1_5', hash }, verifyParams: { name: 'RSASSA-PKCS1-v1_5' }, hash }
    if (family === 'PS')
      return {
        importParams: { name: 'RSA-PSS', hash },
        verifyParams: { name: 'RSA-PSS', saltLength: Number(bits) / 8 },
        hash,
      }
    const namedCurve = bits === '512' ? 'P-521' : `P-${bits}`
    return { importParams: { name: 'ECDSA', namedCurve }, verifyParams: { name: 'ECDSA', hash }, hash }
  }
  if (alg === 'EdDSA' || alg === 'Ed25519') return { importParams: { name: 'Ed25519' }, verifyParams: { name: 'Ed25519' }, hash: 'SHA-512' }
  return undefined
}

export function hashForAlg(alg: string): string | undefined {
  return algParams(alg)?.hash
}

export interface SignatureResult {
  status: 'valid' | 'invalid' | 'unverified'
  detail: string
  kid?: string
  /** No JWKS key matched: the keys may have rotated since the JWKS was fetched. */
  unknownKey?: boolean
}

export function selectKey(jwks: Jwks, header: JsonObject): Jwk | undefined {
  const kid = typeof header.kid === 'string' ? header.kid : undefined
  const alg = typeof header.alg === 'string' ? header.alg : undefined
  const candidates = jwks.keys.filter((k) => !k.use || k.use === 'sig')
  if (kid) return candidates.find((k) => k.kid === kid)
  if (alg) return candidates.find((k) => !k.alg || k.alg === alg)
  return candidates.length === 1 ? candidates[0] : undefined
}

export async function verifySignature(token: DecodedToken, jwks: Jwks | undefined): Promise<SignatureResult> {
  if (token.kind !== 'jwt') return { status: 'unverified', detail: 'Not a signed JWT.' }
  const alg = String(token.header.alg ?? '')
  if (alg === 'none' || alg === '') return { status: 'invalid', detail: 'The token is unsigned (alg "none").' }
  if (alg.startsWith('HS'))
    return { status: 'unverified', detail: `${alg} uses the client secret as the key; it is not checked here.` }
  if (!jwks) return { status: 'unverified', detail: 'No JWKS loaded. Run discovery or set the JWKS URI.' }
  const params = algParams(alg)
  if (!params) return { status: 'unverified', detail: `Algorithm ${alg} is not supported by this browser check.` }
  const jwk = selectKey(jwks, token.header)
  // Not "invalid": after a key rotation the cached JWKS simply lacks the new key.
  if (!jwk) return { status: 'unverified', unknownKey: true, detail: `No key in the JWKS matches kid "${String(token.header.kid ?? '')}", even after fetching the JWKS again.` }
  try {
    // Drop JWK members that importKey rejects or that would restrict usage.
    const keyData: JsonWebKey = { ...jwk }
    for (const member of ['kid', 'alg', 'use', 'key_ops', 'x5c', 'x5t', 'x5t#S256']) delete (keyData as Record<string, unknown>)[member]
    const key = await crypto.subtle.importKey('jwk', keyData, params.importParams, false, ['verify'])
    const signature = base64UrlDecode(token.signature)
    const ok = await crypto.subtle.verify(
      params.verifyParams,
      key,
      signature as BufferSource,
      new TextEncoder().encode(token.signingInput) as BufferSource,
    )
    return ok
      ? { status: 'valid', detail: `Signature verified with ${alg} key "${jwk.kid ?? '(no kid)'}".`, kid: jwk.kid }
      : { status: 'invalid', detail: `Signature does not verify with key "${jwk.kid ?? '(no kid)'}".`, kid: jwk.kid }
  } catch (err) {
    return { status: 'unverified', detail: `Could not verify: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** OIDC at_hash / c_hash: left half of the hash of the ASCII value, base64url encoded. */
export async function halfHash(value: string, alg: string): Promise<string | undefined> {
  const hash = hashForAlg(alg)
  if (!hash) return undefined
  const digest = new Uint8Array(await crypto.subtle.digest(hash, new TextEncoder().encode(value)))
  return base64UrlEncode(digest.slice(0, digest.length / 2))
}

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info'

export interface ClaimCheck {
  name: string
  status: CheckStatus
  detail: string
}

export interface ClaimExpectations {
  issuer?: string
  /** For ID tokens: the client ID, which must be in aud. */
  audience?: string
  nonce?: string
  accessToken?: string
  code?: string
  /** max_age sent on the authorization request: auth_time must then be present and recent enough. */
  maxAge?: number
  /** Seconds of clock skew to tolerate. */
  leeway?: number
  now?: number
}

const asNumber = (v: unknown) => (typeof v === 'number' ? v : undefined)

export function formatEpoch(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString()
}

export async function checkIdTokenClaims(token: DecodedToken, exp: ClaimExpectations): Promise<ClaimCheck[]> {
  if (token.kind !== 'jwt') return []
  const p = token.payload
  const checks: ClaimCheck[] = []
  const now = exp.now ?? Math.floor(Date.now() / 1000)
  const leeway = exp.leeway ?? 60

  if (exp.issuer !== undefined) {
    checks.push(
      p.iss === exp.issuer
        ? { name: 'iss', status: 'pass', detail: `Matches the issuer ${exp.issuer}.` }
        : { name: 'iss', status: 'fail', detail: `Expected ${exp.issuer}, got ${String(p.iss)}.` },
    )
  }
  if (exp.audience !== undefined) {
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud]
    if (!aud.includes(exp.audience)) checks.push({ name: 'aud', status: 'fail', detail: `aud does not contain ${exp.audience}.` })
    else if (aud.length > 1 && p.azp !== exp.audience)
      checks.push({ name: 'aud', status: 'warn', detail: 'Several audiences and azp is not the client ID.' })
    else checks.push({ name: 'aud', status: 'pass', detail: `Contains the client ID ${exp.audience}.` })
    // OIDC Core §3.1.3.7: when azp is present it must be the client ID.
    if (p.azp !== undefined && p.azp !== exp.audience) checks.push({ name: 'azp', status: 'fail', detail: `azp is ${String(p.azp)}, not the client ID ${exp.audience}.` })
  }
  if (typeof p.sub !== 'string' || !p.sub) checks.push({ name: 'sub', status: 'fail', detail: 'Missing sub.' })
  const expiry = asNumber(p.exp)
  if (expiry === undefined) checks.push({ name: 'exp', status: 'fail', detail: 'Missing exp.' })
  else if (expiry + leeway < now) checks.push({ name: 'exp', status: 'fail', detail: `Expired at ${formatEpoch(expiry)}.` })
  else checks.push({ name: 'exp', status: 'pass', detail: `Valid until ${formatEpoch(expiry)}.` })
  const nbf = asNumber(p.nbf)
  if (nbf !== undefined && nbf - leeway > now)
    checks.push({ name: 'nbf', status: 'fail', detail: `Not valid before ${formatEpoch(nbf)}.` })
  const iat = asNumber(p.iat)
  if (iat === undefined) checks.push({ name: 'iat', status: 'warn', detail: 'Missing iat.' })
  else if (iat - leeway > now) checks.push({ name: 'iat', status: 'warn', detail: 'Issued in the future; check clock skew.' })
  if (exp.nonce !== undefined) {
    checks.push(
      p.nonce === exp.nonce
        ? { name: 'nonce', status: 'pass', detail: 'Matches the nonce sent in the request.' }
        : { name: 'nonce', status: 'fail', detail: p.nonce === undefined ? 'nonce missing.' : 'nonce does not match the request.' },
    )
  }
  if (exp.maxAge !== undefined && !Number.isNaN(exp.maxAge)) {
    const authTime = asNumber(p.auth_time)
    if (authTime === undefined) checks.push({ name: 'auth_time', status: 'fail', detail: 'max_age was sent, so auth_time is required (OIDC Core §2).' })
    else if (authTime + exp.maxAge + leeway < now)
      checks.push({ name: 'auth_time', status: 'warn', detail: `Authenticated at ${formatEpoch(authTime)}, more than max_age (${exp.maxAge}s) ago.` })
    else checks.push({ name: 'auth_time', status: 'pass', detail: `Authenticated at ${formatEpoch(authTime)}, within max_age.` })
  }
  const alg = String(token.header.alg ?? '')
  if (exp.accessToken && typeof p.at_hash === 'string') {
    const expected = await halfHash(exp.accessToken, alg)
    checks.push(
      expected === p.at_hash
        ? { name: 'at_hash', status: 'pass', detail: 'Binds the access token.' }
        : { name: 'at_hash', status: 'fail', detail: 'Does not match the access token.' },
    )
  }
  if (exp.code && typeof p.c_hash === 'string') {
    const expected = await halfHash(exp.code, alg)
    checks.push(
      expected === p.c_hash
        ? { name: 'c_hash', status: 'pass', detail: 'Binds the authorization code.' }
        : { name: 'c_hash', status: 'fail', detail: 'Does not match the authorization code.' },
    )
  }
  return checks
}

/** Lighter checks for JWT access tokens: lifetime and issuer only (the audience is the resource). */
export function checkAccessTokenClaims(token: DecodedToken, issuer?: string, now = Math.floor(Date.now() / 1000), leeway = 60): ClaimCheck[] {
  if (token.kind !== 'jwt') return []
  const p = token.payload
  const checks: ClaimCheck[] = []
  if (issuer)
    checks.push(
      p.iss === issuer
        ? { name: 'iss', status: 'pass', detail: 'Matches the issuer.' }
        : { name: 'iss', status: 'fail', detail: `Expected ${issuer}, got ${String(p.iss)}.` },
    )
  const expiry = asNumber(p.exp)
  if (expiry !== undefined)
    checks.push(
      expiry + leeway < now
        ? { name: 'exp', status: 'fail', detail: `Expired at ${formatEpoch(expiry)}.` }
        : { name: 'exp', status: 'pass', detail: `Valid until ${formatEpoch(expiry)}.` },
    )
  if (p.aud !== undefined) checks.push({ name: 'aud', status: 'info', detail: `Audience: ${JSON.stringify(p.aud)}` })
  return checks
}
