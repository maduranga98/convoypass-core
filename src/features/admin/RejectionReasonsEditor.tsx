import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { OTHER_REASON_ID, type RejectionReasonDef } from '@/lib/defaultRejectionReasons'
import { strings } from '@/lib/strings'
import { MAX_REASONS, MIN_REASONS, newReasonId, reasonLabelOk } from './reasons'

const t = strings.admin.reasons
interface Props {
  items: RejectionReasonDef[]
  onChange: (items: RejectionReasonDef[]) => void
  showErrors: boolean
  usingDefaults: boolean
}

/** Add, rename, reorder and remove rejection reasons. "Other" is locked in: it cannot be removed. */
export function RejectionReasonsEditor({ items, onChange, showErrors, usingDefaults }: Props) {
  const update = (index: number, label: string) => onChange(items.map((r, i) => (i === index ? { ...r, label } : r)))
  const move = (index: number, by: -1 | 1) => {
    const target = index + by
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    if (moved) next.splice(target, 0, moved)
    onChange(next)
  }
  const tooFew = items.length < MIN_REASONS

  return (
    <section aria-labelledby="reasons-title" className="space-y-4">
      <div>
        <h2 id="reasons-title" className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-slate-500">{t.hint}</p>
        {usingDefaults && <p className="mt-1 text-sm text-slate-500">{t.usingDefaults}</p>}
      </div>
      <ul className="space-y-3">
        {items.map((r, i) => {
          const locked = r.id === OTHER_REASON_ID
          return (
            <li key={r.id} className="space-y-3 rounded-xl border border-slate-200 bg-surface p-4">
              <Input
                label={t.label}
                value={r.label}
                maxLength={60}
                error={showErrors && !reasonLabelOk(r.label) ? t.labelError : undefined}
                onChange={(e) => update(i, e.target.value)}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                {locked ? (
                  <p className="inline-flex items-center gap-1.5 text-sm text-slate-600"><Lock aria-hidden className="size-4" />{t.locked}</p>
                ) : (
                  <span />
                )}
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={`${t.moveUp}: ${r.label}`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`${t.moveDown}: ${r.label}`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={locked ? `${t.lockedLabel}: ${r.label}` : `${t.remove}: ${r.label}`}
                    disabled={locked || items.length <= MIN_REASONS}
                    onClick={() => onChange(items.filter((_, n) => n !== i))}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {tooFew && <p role="alert" className="text-sm text-danger">{t.min}</p>}
      <Button
        variant="secondary"
        icon={<Plus aria-hidden className="size-4" />}
        disabled={items.length >= MAX_REASONS}
        onClick={() => onChange([...items, { id: newReasonId(), label: '' }])}
      >
        {t.add}
      </Button>
      {items.length >= MAX_REASONS && <p className="text-xs text-slate-500">{t.max}</p>}
    </section>
  )
}
