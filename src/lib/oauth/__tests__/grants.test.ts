import { describe, expect, it } from 'vitest'
import { TOKEN_TYPES, clientCredentialsGrant, nextPollStep, tokenExchangeForm, type GrantResult } from '../client'
import type { HttpExchange } from '../http'

const ex = {} as HttpExchange
const pending = (error: string): GrantResult => ({ exchange: ex, error: { error } })

describe('token exchange form', () => {
  it('sends the required fields and leaves empty optional ones out', () => {
    const form = tokenExchangeForm({ subjectToken: ' abc ', subjectTokenType: TOKEN_TYPES.access_token, audience: '', scope: 'read' })
    expect(form.grant_type).toBe('urn:ietf:params:oauth:grant-type:token-exchange')
    expect(form.subject_token).toBe('abc')
    expect(form.scope).toBe('read')
    expect(form.audience).toBeUndefined()
    expect(form.actor_token).toBeUndefined()
    expect(form.actor_token_type).toBeUndefined()
  })

  it('sends the actor token with its type', () => {
    const form = tokenExchangeForm({ subjectToken: 's', subjectTokenType: TOKEN_TYPES.jwt, actorToken: 'a', actorTokenType: TOKEN_TYPES.access_token })
    expect(form.actor_token).toBe('a')
    expect(form.actor_token_type).toBe(TOKEN_TYPES.access_token)
  })

  it('asks for the missing pieces', () => {
    expect(() => tokenExchangeForm({ subjectToken: '', subjectTokenType: TOKEN_TYPES.jwt })).toThrow(/subject token/)
    expect(() => tokenExchangeForm({ subjectToken: 's', subjectTokenType: TOKEN_TYPES.jwt, actorToken: 'a' })).toThrow(/actor token type/)
  })
})

describe('client credentials', () => {
  it('needs a confidential client', async () => {
    await expect(clientCredentialsGrant({ tokenEndpoint: 'https://as.example/token', creds: { clientId: 'c', method: 'none' } })).rejects.toThrow(/confidential/)
  })
})

describe('device code polling', () => {
  it('keeps waiting while authorization is pending', () => {
    expect(nextPollStep(pending('authorization_pending'), 5)).toEqual({ kind: 'wait', interval: 5 })
  })
  it('adds five seconds on slow_down (RFC 8628 §3.5)', () => {
    expect(nextPollStep(pending('slow_down'), 5)).toEqual({ kind: 'wait', interval: 10 })
  })
  it('stops on denial, expiry and other errors', () => {
    expect(nextPollStep(pending('access_denied'), 5).kind).toBe('stop')
    expect(nextPollStep(pending('expired_token'), 5).kind).toBe('stop')
    expect(nextPollStep(pending('invalid_client'), 5)).toEqual({ kind: 'stop', reason: 'invalid_client' })
  })
  it('finishes when tokens arrive', () => {
    expect(nextPollStep({ exchange: ex, tokens: { access_token: 'x' } }, 5)).toEqual({ kind: 'done' })
  })
})
