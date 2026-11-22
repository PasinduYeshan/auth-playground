// The configuration model. A Profile is what users save and share; it never holds a client secret.
import type { PkceMethod } from './pkce'

export type ClientAuthMethod = 'none' | 'client_secret_basic' | 'client_secret_post'

export interface Endpoints {
  authorization: string
  token: string
  userinfo: string
  introspection: string
  revocation: string
  jwks: string
  endSession: string
}

export interface KeyValue {
  key: string
  value: string
  enabled: boolean
}

export interface Organization {
  /** The value substituted for {org}: an OU ID on ThunderID. */
  id: string
  name: string
  handle?: string
}

/** How a server selects an organization. Templates take {issuer} and {org}. */
export interface B2BConfig {
  style: 'path' | 'param'
  authorizeTemplate: string
  tokenTemplate: string
  /** For style 'param': the authorization request parameter that names the organization. */
  paramName: string
  /** Endpoint that lists the user's organizations with their access token (ThunderID: /users/me/ous). */
  listTemplate: string
  /** Redeem codes from an organization sign-in at the organization's token endpoint. */
  redeemAtOrgTokenEndpoint: boolean
  organizations: Organization[]
}

export const thunderIdB2B = (): B2BConfig => ({
  style: 'path',
  authorizeTemplate: '{issuer}/ou/{org}/oauth2/authorize',
  tokenTemplate: '{issuer}/ou/{org}/oauth2/token',
  paramName: 'organization',
  listTemplate: '{issuer}/users/me/ous',
  redeemAtOrgTokenEndpoint: true,
  organizations: [],
})

export interface Profile {
  id: string
  name: string
  issuer: string
  endpoints: Endpoints
  clientId: string
  clientAuthMethod: ClientAuthMethod
  redirectUri: string
  scope: string
  /** RFC 8707 resource indicators, one per entry. */
  resources: string[]
  responseMode: '' | 'query' | 'fragment' | 'form_post'
  pkceMethod: PkceMethod
  useNonce: boolean
  prompt: string
  loginHint: string
  maxAge: string
  acrValues: string
  uiLocales: string
  /** Any other authorization request parameter (claims, display, id_token_hint, vendor parameters). */
  extraAuthParams: KeyValue[]
  /** Extra form fields for the token request. */
  extraTokenParams: KeyValue[]
  /** Credentials for introspection when it needs a different (confidential) client. */
  introspectionClientId: string
  introspectionAuthMethod: ClientAuthMethod
  b2b: B2BConfig
  updatedAt: number
}

export const emptyEndpoints = (): Endpoints => ({
  authorization: '',
  token: '',
  userinfo: '',
  introspection: '',
  revocation: '',
  jwks: '',
  endSession: '',
})

export function defaultRedirectUri(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/callback`
}

export function newProfile(partial: Partial<Profile> = {}): Profile {
  return {
    id: crypto.randomUUID(),
    name: 'New configuration',
    issuer: '',
    endpoints: emptyEndpoints(),
    clientId: '',
    clientAuthMethod: 'none',
    redirectUri: defaultRedirectUri(),
    scope: 'openid profile',
    resources: [],
    responseMode: '',
    pkceMethod: 'S256',
    useNonce: true,
    prompt: '',
    loginHint: '',
    maxAge: '',
    acrValues: '',
    uiLocales: '',
    extraAuthParams: [],
    extraTokenParams: [],
    introspectionClientId: '',
    introspectionAuthMethod: 'client_secret_basic',
    b2b: thunderIdB2B(),
    updatedAt: Date.now(),
    ...partial,
  }
}

/** Secrets the user typed this session. Kept in memory only, keyed by profile ID. */
export interface SessionSecrets {
  clientSecret: string
  introspectionClientSecret: string
}

export interface TokenResponse {
  access_token?: string
  token_type?: string
  expires_in?: number
  refresh_token?: string
  id_token?: string
  scope?: string
  issued_token_type?: string
  [key: string]: unknown
}

export type GrantKind = 'authorization_code' | 'refresh_token' | 'device_secret_exchange' | 'manual'

/** One set of tokens from one grant, the unit the token views compare. */
export interface TokenSet {
  id: string
  label: string
  grant: GrantKind
  profileId: string
  obtainedAt: number
  response: TokenResponse
  /** Nonce and code used to validate the ID token's nonce and c_hash. */
  nonce?: string
  code?: string
  /** Organization the set was obtained in, when the request named one. */
  organization?: Organization
  /** Token endpoint that issued the set (the organization's, for org-scoped redemption). */
  tokenEndpoint?: string
  /** ID of the set this one was derived from (refresh, switch). */
  parentId?: string
  /** Statuses learned from operations (revocation, introspection). */
  revoked?: { access?: number; refresh?: number }
}
