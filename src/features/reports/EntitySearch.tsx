import { X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { strings } from '@/lib/strings'

export interface EntityOption {
  id: string
  label: string
  hint?: string
}

const t = strings.reports.filters
const MAX_SHOWN = 8

/** Search a cached list (vehicles by plate, drivers by name) and pick one. */
export function EntitySearch({ label, placeholder, options, value, onChange, loading }: {
  label: string
  placeholder: string
  options: EntityOption[]
  value: string
  onChange: (id: string) => void
  loading?: boolean
}) {
  const [text, setText] = useState('')
  const listId = useId()
  const selected = options.find((o) => o.id === value)
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase().replaceAll(/\s+/g, '')
    if (!q) return []
    return options.filter((o) => `${o.label}${o.hint ?? ''}`.toLowerCase().replaceAll(/\s+/g, '').includes(q)).slice(0, MAX_SHOWN)
  }, [options, text])

  if (value) {
    return (
      <div className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        <span>{label}</span>
        <span className="inline-flex h-10 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 font-normal">
          <span className="truncate">{selected ? selected.label : value}{selected?.hint ? <span className="text-slate-500"> · {selected.hint}</span> : null}</span>
          <button type="button" aria-label={`${t.clear}: ${label}`} onClick={() => { onChange(''); setText('') }} className="rounded p-1 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-focus">
            <X aria-hidden className="size-4" />
          </button>
        </span>
      </div>
    )
  }
  return (
    <div className="relative flex flex-col gap-1 text-sm font-medium text-slate-700">
      <label htmlFor={`${listId}-input`}>{label}</label>
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={text}
        placeholder={loading ? strings.common.loading : placeholder}
        onChange={(e) => setText(e.target.value)}
        className="h-10 rounded-lg border border-slate-300 bg-surface px-3 text-sm font-normal focus-visible:outline-2 focus-visible:outline-focus"
      />
      {text.trim() !== '' && (
        <ul id={listId} role="listbox" aria-label={label} className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-surface py-1 shadow-lg">
          {matches.length === 0 ? (
            <li role="presentation" className="px-3 py-2 font-normal text-slate-500">{t.noMatches}</li>
          ) : (
            matches.map((o) => (
              <li key={o.id} role="option" aria-selected={false}>
                <button type="button" onClick={() => { onChange(o.id); setText('') }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-normal hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
                  <span>{o.label}</span>
                  {o.hint && <span className="text-slate-500">{o.hint}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
