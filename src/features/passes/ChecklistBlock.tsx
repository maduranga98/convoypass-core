import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { ChecklistItemDef } from '@/lib/defaultChecklist'
import { strings } from '@/lib/strings'
import { noteMissing, type Answers } from './checklist'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.pass.form

interface Props {
  items: readonly ChecklistItemDef[]
  answers: Answers
  onChange: (next: Answers) => void
  onAllOk: () => void
  disabled?: boolean
}

const segment = (selected: boolean, tone: 'yes' | 'no') =>
  cn(
    'h-14 flex-1 rounded-xl border-2 text-lg font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    selected
      ? tone === 'yes'
        ? 'border-success-strong bg-success-strong text-on-solid'
        : 'border-danger-strong bg-danger-strong text-on-solid'
      : 'border-slate-400 bg-surface text-ink hover:bg-slate-100',
  )

export function ChecklistBlock({ items, answers, onChange, onAllOk, disabled }: Props) {
  const set = (id: string, entry: Answers[string]) => onChange({ ...answers, [id]: entry })

  return (
    <div className="space-y-4">
      <Button variant="secondary" className="h-14 w-full text-base" disabled={disabled} onClick={onAllOk}>
        {t.allOk}
      </Button>

      <ul className="space-y-4">
        {items.map((item) => {
          const entry = answers[item.id]
          const labelId = `chk-${item.id}`
          const isNo = entry?.answer === 'no'
          const noteId = `chk-note-${item.id}`
          return (
            <li key={item.id} className="space-y-3 rounded-2xl border border-slate-300 bg-surface p-4">
              <p id={labelId} className="text-base font-semibold">{item.label}</p>
              <div role="radiogroup" aria-labelledby={labelId} className="flex gap-3">
                <button
                  type="button" role="radio" aria-checked={entry?.answer === 'yes'} disabled={disabled}
                  className={segment(entry?.answer === 'yes', 'yes')}
                  onClick={() => set(item.id, { answer: 'yes' })}
                >
                  {t.yes}
                </button>
                <button
                  type="button" role="radio" aria-checked={isNo} disabled={disabled}
                  className={segment(isNo, 'no')}
                  onClick={() => set(item.id, { answer: 'no', ...(entry?.note ? { note: entry.note } : {}) })}
                >
                  {t.no}
                </button>
              </div>

              {isNo && (
                <div className="space-y-2">
                  <label htmlFor={noteId} className="block text-sm font-semibold">{t.noteLabel}</label>
                  <textarea
                    id={noteId} rows={2} maxLength={200} value={entry?.note ?? ''} placeholder={t.notePlaceholder}
                    aria-invalid={noteMissing(answers, item.id)} aria-required="true" disabled={disabled}
                    onChange={(e) => set(item.id, { answer: 'no', note: e.target.value })}
                    className="w-full rounded-xl border-2 border-slate-400 bg-surface px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-focus aria-invalid:border-danger"
                  />
                  <p className="flex items-center gap-2 text-sm font-medium text-warning-ink">
                    <TriangleAlert aria-hidden className="size-4 shrink-0" /> {t.noteWarning}
                  </p>
                  {item.failBlocks && (
                    <NotificationBanner tone="error">{t.failBlocks}</NotificationBanner>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
