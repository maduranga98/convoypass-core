import { useId } from 'react'
import { cn } from '@/lib/cn'

export interface CheckOption {
  id: string
  label: string
  hint?: string
  /** This one cannot be ticked (an already ticked option stays enabled so it can be cleared). */
  disabled?: boolean
}

interface CheckListProps {
  legend: string
  options: CheckOption[]
  value: string[]
  onChange: (next: string[]) => void
  emptyText: string
  disabled?: boolean
  className?: string
}

/** Accessible multi-select: a scrollable group of native checkboxes. */
export function CheckList({ legend, options, value, onChange, emptyText, disabled, className }: CheckListProps) {
  const name = useId()
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  return (
    <fieldset disabled={disabled} className={cn('space-y-1.5', className)}>
      <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      {options.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">{emptyText}</p>
      ) : (
        <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-300 bg-surface">
          {options.map((o) => (
            <li key={o.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm has-[:disabled]:cursor-not-allowed has-[:focus-visible]:bg-slate-50">
                <input
                  type="checkbox"
                  name={name}
                  checked={value.includes(o.id)}
                  onChange={() => toggle(o.id)}
                  disabled={o.disabled === true}
                  className="size-4 rounded border-slate-300 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                />
                <span className="min-w-0 flex-1 truncate text-ink">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-slate-500">{o.hint}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
