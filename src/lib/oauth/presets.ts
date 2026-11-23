// Provider presets. A preset only fills defaults (organization handling, claim names, placeholders)
// and shows notes about known server behaviour; every value stays editable, and the protocol code is
// the same for every provider.
import { genericB2B, type B2BConfig } from './types'

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
  },
]

export function presetById(id: string | undefined): ProviderPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}
