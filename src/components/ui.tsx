import { Check, ChevronDown, ChevronRight, Copy, Eye, EyeOff } from 'lucide-react'
import { useState, type ReactNode } from 'react'

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={cx('btn-ghost px-1.5 py-1 text-xs', className)}
      title="Copy to clipboard"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
      {label}
    </button>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-zinc-500">{hint}</span>}
    </label>
  )
}

export function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input
        className="input pr-8"
        type={shown ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="absolute top-1.5 right-2 text-zinc-400 hover:text-zinc-600" onClick={() => setShown(!shown)} title={shown ? 'Hide' : 'Show'}>
        {shown ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue' | 'violet'
const tones: Record<Tone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-400',
  red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-400',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-400',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-400',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-400',
}

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-transparent ring-inset', tones[tone])}>
      {children}
    </span>
  )
}

export function statusTone(status: number | undefined): Tone {
  if (!status) return 'red'
  if (status < 300) return 'green'
  if (status < 400) return 'blue'
  if (status < 500) return 'amber'
  return 'red'
}

export function Section({
  title,
  children,
  defaultOpen = true,
  actions,
  subtitle,
}: {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  actions?: ReactNode
  subtitle?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button type="button" className="flex flex-1 items-center gap-1.5 text-left text-sm font-semibold" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {title}
          {subtitle && <span className="ml-1 truncate text-xs font-normal text-zinc-500">{subtitle}</span>}
        </button>
        {actions}
      </div>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </section>
  )
}

/** Pretty JSON with light syntax colouring. */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const html = escapeHtml(text ?? '').replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = 'text-amber-600 dark:text-amber-400'
      if (m.startsWith('"')) cls = m.trimEnd().endsWith(':') ? 'text-indigo-600 dark:text-indigo-400' : 'text-emerald-700 dark:text-emerald-400'
      else if (/true|false|null/.test(m)) cls = 'text-rose-600 dark:text-rose-400'
      return `<span class="${cls}">${m}</span>`
    },
  )
  return (
    <pre
      className={cx('code overflow-auto rounded-lg bg-zinc-50 p-3 leading-relaxed whitespace-pre-wrap break-all dark:bg-zinc-950', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cx(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition',
            value === t.id ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">{children}</div>
}

export function Alert({ tone = 'amber', children }: { tone?: 'amber' | 'red' | 'blue' | 'green'; children: ReactNode }) {
  const map = {
    amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
    red: 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200',
    blue: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200',
    green: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
  }
  return <div className={cx('rounded-lg border px-3 py-2 text-sm', map[tone])}>{children}</div>
}
