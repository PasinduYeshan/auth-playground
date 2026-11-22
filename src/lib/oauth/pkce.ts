// PKCE (RFC 7636). The verifier is 32 random bytes, base64url encoded: 43 characters from the
// unreserved set, the minimum length the RFC allows with the recommended entropy.
import { base64UrlEncode, randomString, sha256 } from './encoding'

export type PkceMethod = 'S256' | 'plain'

export function generateCodeVerifier(): string {
  return randomString(32)
}

export async function computeCodeChallenge(verifier: string, method: PkceMethod): Promise<string> {
  if (method === 'plain') return verifier
  return base64UrlEncode(await sha256(verifier))
}

const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/

export function isValidCodeVerifier(verifier: string): boolean {
  return VERIFIER_PATTERN.test(verifier)
}
