import { HttpExchangeView } from '../components/HttpExchangeView'
import { Empty } from '../components/ui'
import { setState, useAppState } from '../lib/store/appStore'

export function HttpLogView() {
  const exchanges = useAppState((s) => s.exchanges)
  const reveal = useAppState((s) => s.revealSecrets)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="text-lg font-semibold">HTTP log</h2>
          <p className="text-sm text-zinc-500">Every request this tab sent, newest first. Kept in this tab only.</p>
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={reveal} onChange={(e) => setState({ revealSecrets: e.target.checked })} /> Reveal secrets and tokens
        </label>
        {exchanges.length > 0 && (
          <button type="button" className="btn-ghost text-xs" onClick={() => setState({ exchanges: [] })}>
            Clear
          </button>
        )}
      </div>
      {exchanges.length === 0 ? <Empty>No requests yet.</Empty> : exchanges.map((ex) => <HttpExchangeView key={ex.id} exchange={ex} />)}
    </div>
  )
}
