// Provider presets. A preset only fills defaults (organization handling, claim names, placeholders)
// and shows notes about known server behaviour; every value stays editable, and the protocol code is
// the same for every provider.
import { genericB2B, type B2BConfig, type Endpoints, type Profile } from './types'
import { isHttpUrl } from './url'

export interface ProviderPreset {
  id: string
  name: string
  /** Placeholder for the issuer or base URL field. */
  issuerPlaceholder: string
  issuerHint: string
  b2b: () => B2BConfig
  /** Short notes shown in the configuration panel. */
  notes: string[]
  /** Scope suggestions beyond what discovery reports. */
  extraScopes: string[]
  /** Base URL filled in when this preset is chosen and the field is empty. */
  defaultIssuer?: string
  /** The server's usual endpoint paths, filled in from the base URL so it works without discovery. */
  endpointPaths?: Partial<Record<keyof Endpoints, string>>
}

export const PRESETS: ProviderPreset[] = [
  {
    id: 'generic',
    name: 'Generic OAuth 2.0 / OpenID Connect',
    issuerPlaceholder: 'https://idp.example.com',
    issuerHint: 'The issuer URL. Discovery reads /.well-known/openid-configuration (or oauth-authorization-server).',
    b2b: genericB2B,
    notes: [],
    extraScopes: [],
  },
  {
    id: 'thunderid',
    name: 'ThunderID',
    issuerPlaceholder: 'https://localhost:8090',
    issuerHint: 'The ThunderID base URL, which is also its issuer.',
    b2b: () => ({
      ...genericB2B(),
      style: 'path',
      authorizeTemplate: '{issuer}/ou/{org}/oauth2/authorize',
      tokenTemplate: '{issuer}/ou/{org}/oauth2/token',
      listTemplate: '{issuer}/users/me/ous',
      redeemAtOrgTokenEndpoint: true,
      refreshAtOrgTokenEndpoint: false,
      orgClaims: { id: 'ouId', name: 'ouName', handle: 'ouHandle' },
      switchExchange: { subjectTokenField: 'device_secret', subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt' },
    }),
    notes: [
      'Allow this site\'s origin in config/resources/server_configs/cors.yaml (allowedOrigins) and restart the server.',
      'The token endpoint answers no CORS preflight: use a public client (none) or client_secret_post, not client_secret_basic.',
      'PKCE S256 and response_mode query only.',
      'Organizations are organization units (OUs), selected by ID in the path. Share the application with them and add ouId, ouName and ouHandle to its access token attributes.',
      'The device_sso scope returns a device_secret, which switches organization by token exchange.',
      'Its API error responses (such as a 401 from /users/me/ous) carry no CORS headers, so the browser reports a refused request as a network error. The server log shows the real status.',
    ],
    extraScopes: ['device_sso'],
    defaultIssuer: 'https://localhost:8090',
    endpointPaths: {
      authorization: '/oauth2/authorize',
      token: '/oauth2/token',
      userinfo: '/oauth2/userinfo',
      introspection: '/oauth2/introspect',
      revocation: '/oauth2/revoke',
      jwks: '/oauth2/jwks',
      endSession: '/oauth2/logout',
      deviceAuthorization: '/oauth2/device-authorize',
      par: '/oauth2/par',
    },
  },
]

export function presetById(id: string | undefined): ProviderPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}

/** The endpoints a preset expects under a base URL, or nothing while the URL is incomplete. */
export function templateEndpoints(preset: ProviderPreset, issuer: string): Partial<Endpoints> {
  const base = issuer.trim().replace(/\/+$/, '')
  if (!preset.endpointPaths || !isHttpUrl(base)) return {}
  return Object.fromEntries(Object.entries(preset.endpointPaths).map(([k, path]) => [k, base + path]))
}

/** The profile change for a new base URL or preset. Endpoints follow the preset's paths, except
 * ones the user typed or discovery set to something else, which stay. */
export function serverPatch(profile: Profile, next: { issuer?: string; preset?: string }): Partial<Profile> {
  const oldPreset = presetById(profile.preset)
  const preset = presetById(next.preset ?? profile.preset)
  let issuer = next.issuer ?? profile.issuer
  if (next.preset && !issuer.trim() && preset.defaultIssuer) issuer = preset.defaultIssuer
  const before = templateEndpoints(oldPreset, profile.issuer)
  const after = templateEndpoints(preset, issuer)
  const endpoints = { ...profile.endpoints }
  for (const key of Object.keys(endpoints) as (keyof Endpoints)[]) {
    const current = endpoints[key]
    const followed = !current || current === before[key]
    if (followed) endpoints[key] = after[key] ?? (current === before[key] ? '' : current)
  }
  const patch: Partial<Profile> = { issuer, endpoints }
  if (next.preset) patch.preset = preset.id
  return patch
}
