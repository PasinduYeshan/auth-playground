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
  /** RFC 8628 device authorization endpoint. */
  deviceAuthorization: string
  /** RFC 9126 pushed authorization request endpoint. */
  par: string
}

export interface KeyValue {
  key: string
  value: string
  enabled: boolean
}

export interface Organization {
  /** The value substituted for {org} in templates, or sent as the organization parameter. */
  id: string
  name: string
  handle?: string
}

/** Claims that name the organization a token was issued for. */
export interface OrgClaims {
  id: string
  name: string
  handle: string
}

/** Switching organization by token exchange (RFC 8693) at the organization's token endpoint. */
export interface OrgSwitchExchange {
  /** Field of the token response used as the subject token (for example device_secret or access_token). */
  subjectTokenField: string
  subjectTokenType: string
}

/** How a server selects an organization. Templates take {issuer} and {org}. */
export interface B2BConfig {
  style: 'path' | 'param'
  authorizeTemplate: string
  tokenTemplate: string
  /** For style 'param': the authorization request parameter that names the organization. */
  paramName: string
  /** Optional endpoint that lists the user's organizations, called with their access token. */
  listTemplate: string
  /** Redeem codes from an organization sign-in at the organization's token endpoint (style 'path'). */
  redeemAtOrgTokenEndpoint: boolean
  /** Send refresh requests to the organization's token endpoint instead of the default one. */
  refreshAtOrgTokenEndpoint: boolean
  orgClaims: OrgClaims
  switchExchange: OrgSwitchExchange
  organizations: Organization[]
}

export const genericB2B = (): B2BConfig => ({
  style: 'param',
  authorizeTemplate: '{issuer}/o/{org}/authorize',
  tokenTemplate: '{issuer}/o/{org}/token',
  paramName: 'organization',
  listTemplate: '',
  redeemAtOrgTokenEndpoint: true,
  refreshAtOrgTokenEndpoint: false,
  orgClaims: { id: 'org_id', name: 'org_name', handle: '' },
  switchExchange: { subjectTokenField: 'access_token', subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token' },
  organizations: [],
})

export interface Profile {
  id: string
  name: string
  /** Provider preset (see presets.ts): fills defaults and shows provider-specific notes. */
  preset: string
  issuer: string
  endpoints: Endpoints
  /** The sign-in client's ID and authentication method: always the same as its entry in `clients`. */
  clientId: string
  clientAuthMethod: ClientAuthMethod
  redirectUri: string
  scope: string
  /** RFC 8707 resource indicators, one per entry. */
  resources: string[]
  responseMode: '' | 'query' | 'fragment' | 'form_post'
  pkceMethod: PkceMethod
  useNonce: boolean
  /** The server sends iss in authorization responses (RFC 9207), learned from discovery: a response
   * without it is then rejected. */
  expectIss: boolean
  prompt: string
  loginHint: string
  maxAge: string
  acrValues: string
  uiLocales: string
  /** Any other authorization request parameter (claims, display, id_token_hint, vendor parameters). */
  extraAuthParams: KeyValue[]
  /** Push the authorization request to the PAR endpoint (RFC 9126) and redirect with a request_uri. */
  usePar: boolean
  /** Redeem the code as soon as the callback checks pass, instead of waiting for the user. */
  redeemCodeAutomatically: boolean
  /** Extra form fields for the token request. */
  extraTokenParams: KeyValue[]
  /** The clients registered for this server, by name. Secrets are never saved (see SessionSecrets). */
  clients: ClientConfig[]
  /** The client sign-in uses (a ClientConfig id). `clientId` and `clientAuthMethod` mirror it. */
  signInClient: string
  /** The client introspection uses (a ClientConfig id); empty: the token's own client. */
  introspectionClient: string
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
  deviceAuthorization: '',
  par: '',
})

export function defaultRedirectUri(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/callback`
}

export function newProfile(partial: Partial<Profile> = {}): Profile {
  const base: Profile = {
    id: crypto.randomUUID(),
    name: 'New configuration',
    preset: 'generic',
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
    expectIss: false,
    prompt: '',
    loginHint: '',
    maxAge: '',
    acrValues: '',
    uiLocales: '',
    extraAuthParams: [],
    usePar: false,
    redeemCodeAutomatically: false,
    extraTokenParams: [],
    clients: [],
    signInClient: DEFAULT_CLIENT,
    introspectionClient: '',
    b2b: genericB2B(),
    updatedAt: Date.now(),
    ...partial,
  }
  if (!partial.clients?.length) base.clients = [{ id: DEFAULT_CLIENT, name: 'Default', clientId: base.clientId, authMethod: base.clientAuthMethod }]
  return withSignInClient(base)
}

/** Secrets the user typed this session. Kept in memory only, keyed by profile ID. */
export interface SessionSecrets {
  /** Client secrets by ClientConfig id. */
  clientSecrets: Record<string, string>
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

export type GrantKind = 'authorization_code' | 'refresh_token' | 'client_credentials' | 'device_code' | 'token_exchange' | 'manual'

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
  /** The client the set was issued to, when it is not the configuration's own client. */
  client?: { clientId: string; method: ClientAuthMethod }
  /** max_age sent on the authorization request, for the auth_time check. */
  maxAge?: number
  /** Statuses learned from operations (revocation, introspection). */
  revoked?: { access?: number; refresh?: number }
}

/** A client registered for the server. Several can share one configuration (a browser app, a
 * machine-to-machine client, a client for introspection); each is chosen where it is used. */
export interface ClientConfig {
  id: string
  name: string
  clientId: string
  authMethod: ClientAuthMethod
}

export const DEFAULT_CLIENT = 'default'

/** The profile with `clientId` and `clientAuthMethod` copied from the sign-in client, which always
 * exists: the protocol code reads those two fields. */
export function withSignInClient(profile: Profile): Profile {
  const clients = profile.clients.length ? profile.clients : [{ id: DEFAULT_CLIENT, name: 'Default', clientId: profile.clientId, authMethod: profile.clientAuthMethod }]
  const chosen = clients.find((c) => c.id === profile.signInClient) ?? clients[0]
  const introspectionClient = clients.some((c) => c.id === profile.introspectionClient) ? profile.introspectionClient : ''
  return { ...profile, clients, signInClient: chosen.id, clientId: chosen.clientId, clientAuthMethod: chosen.authMethod, introspectionClient }
}

/** Applies a change to a profile. Setting `clientId` or `clientAuthMethod` edits the sign-in client. */
export function patchProfile(profile: Profile, patch: Partial<Profile>): Profile {
  let next: Profile = { ...profile, ...patch }
  if (!patch.clients && (patch.clientId !== undefined || patch.clientAuthMethod !== undefined)) {
    next = {
      ...next,
      clients: next.clients.map((c) =>
        c.id === next.signInClient ? { ...c, clientId: patch.clientId ?? c.clientId, authMethod: patch.clientAuthMethod ?? c.authMethod } : c,
      ),
    }
  }
  return withSignInClient(next)
}
