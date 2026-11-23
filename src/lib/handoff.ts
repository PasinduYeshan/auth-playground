// Hands an authorization response from the sign-in tab to the playground tab that started the request.
//
// Sign-in runs in its own tab so the playground keeps its state and several sign-ins can run at once.
// The transaction (state, nonce, PKCE verifier) never leaves the playground tab: the callback tab
// sends only the response parameters over a same-origin BroadcastChannel, and the tab holding the
// matching state answers. If no tab answers (the playground was closed, or the response came back in
// the same tab), the callback page completes the response itself.

export const CHANNEL = 'ap:authorization-response'

export type HandoffMessage =
  | { type: 'response'; id: string; raw: Record<string, string>; source: 'query' | 'fragment' }
  | { type: 'accepted'; id: string }

function channel(): BroadcastChannel | undefined {
  return typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(CHANNEL)
}

/** Callback tab: offers the response and resolves true if a playground tab took it. */
export function offerResponse(raw: Record<string, string>, source: 'query' | 'fragment', timeoutMs = 1500): Promise<boolean> {
  const ch = channel()
  if (!ch) return Promise.resolve(false)
  const id = crypto.randomUUID()
  return new Promise((resolve) => {
    const done = (taken: boolean) => {
      clearTimeout(timer)
      ch.close()
      resolve(taken)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    ch.onmessage = (e: MessageEvent<HandoffMessage>) => {
      if (e.data?.type === 'accepted' && e.data.id === id) done(true)
    }
    ch.postMessage({ type: 'response', id, raw, source } satisfies HandoffMessage)
  })
}

/** Playground tab: takes responses whose state this tab holds. Returns a function that stops listening. */
export function listenForResponses(
  holds: (state: string) => boolean,
  accept: (raw: Record<string, string>, source: 'query' | 'fragment') => void,
): () => void {
  const ch = channel()
  if (!ch) return () => {}
  ch.onmessage = (e: MessageEvent<HandoffMessage>) => {
    const msg = e.data
    if (msg?.type !== 'response' || !msg.raw || typeof msg.raw !== 'object') return
    const state = msg.raw.state
    if (typeof state !== 'string' || !holds(state)) return
    ch.postMessage({ type: 'accepted', id: msg.id } satisfies HandoffMessage)
    accept(msg.raw, msg.source === 'fragment' ? 'fragment' : 'query')
  }
  return () => ch.close()
}
