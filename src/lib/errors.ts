// Plain-language hints for OAuth error codes, shown next to the server's own description.
export const ERROR_HINTS: Record<string, string> = {
  access_denied: 'The user or the server refused the request.',
  unauthorized_client: 'The client may not use this flow, or it is not available in the requested organization.',
  invalid_request: 'A parameter is missing or malformed. Check the redirect URI, PKCE method and scope.',
  invalid_scope: 'A requested scope is unknown or not allowed for this client.',
  login_required: 'prompt=none was sent but there is no session to reuse. Sign in interactively.',
  interaction_required: 'prompt=none was sent but the server needs the user.',
  consent_required: 'prompt=none was sent but consent is needed.',
  invalid_target: 'A resource indicator is unknown or not allowed.',
  invalid_grant: 'The code is invalid, expired, already used, or the PKCE verifier or redirect URI does not match.',
  invalid_client: 'Client authentication failed: check the client ID, method and secret.',
  invalid_request_uri: 'The request_uri is unknown, expired or already used. Push the request again.',
  request_uri_not_supported: 'The server does not accept request_uri. Turn PAR off or check the server supports it.',
  network_error: 'The browser blocked the request. Most often the server does not allow this origin (CORS).',
}
