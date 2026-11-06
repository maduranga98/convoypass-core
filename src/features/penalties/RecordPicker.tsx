import { useId, useMemo, useState } from 'react'
import { SearchField } from '@/components/ui/SearchField'
import { matchesSearch } from '@/features/shared/list'

export interface PickOption {
  id: string
  label: string
  hint?: string | undefined
  /** Extra words the search also matches (plate key, phone, contractor). */
  search?: string | undefined
  /** A short flag shown at the right, such as "Already blocked". */
  flag?: string | undefined
}

interface Props {
  legend: string
  searchLabel: string
  options: PickOption[]
  value: string | null
  onChange: (id: string | null) => void
  emptyText: string
  noMatchText: string
  disabled?: boolean
}

const MAX_SHOWN = 50

/** Searchable single choice: a search box over a scrollable group of native radios (keyboard and screen reader friendly). */
export function RecordPicker({ legend, searchLabel, options, value, onChange, emptyText, noMatchText, disabled }: Props) {
  const name = useId()
  const [search, setSearch] = useState('')
  const shown = useMemo(() => {
    const matched = options.filter((o) => matchesSearch(`${o.label} ${o.hint ?? ''} ${o.search ?? ''}`, search))
    // The chosen record stays visible whatever the search says.
    const chosen = value ? options.find((o) => o.id === value) : undefined
    const list = matched.slice(0, MAX_SHOWN)
    return chosen && !list.includes(chosen) ? [chosen, ...list] : list
  }, [options, search, value])

  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      <SearchField label={searchLabel} placeholder={searchLabel} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-none" />
      {options.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">{emptyText}</p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">{noMatchText}</p>
      ) : (
        <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-300 bg-surface">
          {shown.map((o) => (
            <li key={o.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm has-[:checked]:bg-slate-50 has-[:disabled]:cursor-not-allowed has-[:focus-visible]:bg-slate-50">
                <input
                  type="radio"
                  name={name}
                  checked={value === o.id}
                  onChange={() => onChange(o.id)}
                  className="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{o.label}</span>
                  {o.hint && <span className="block truncate text-xs text-slate-600">{o.hint}</span>}
                </span>
                {o.flag && <span className="shrink-0 text-xs font-medium text-danger-strong">{o.flag}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
