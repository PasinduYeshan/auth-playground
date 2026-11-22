import { Plus, Trash2 } from 'lucide-react'
import type { KeyValue } from '../lib/oauth/types'

export function KeyValueEditor({ value, onChange, keyPlaceholder = 'name', valuePlaceholder = 'value' }: {
  value: KeyValue[]
  onChange: (v: KeyValue[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  const set = (i: number, patch: Partial<KeyValue>) => onChange(value.map((kv, j) => (j === i ? { ...kv, ...patch } : kv)))
  return (
    <div className="space-y-1.5">
      {value.map((kv, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input type="checkbox" checked={kv.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} title="Send this parameter" />
          <input className="input code w-2/5" value={kv.key} placeholder={keyPlaceholder} onChange={(e) => set(i, { key: e.target.value })} />
          <input className="input code flex-1" value={kv.value} placeholder={valuePlaceholder} onChange={(e) => set(i, { value: e.target.value })} />
          <button type="button" className="btn-ghost px-1.5" onClick={() => onChange(value.filter((_, j) => j !== i))} title="Remove">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => onChange([...value, { key: '', value: '', enabled: true }])}>
        <Plus size={14} /> Add parameter
      </button>
    </div>
  )
}
