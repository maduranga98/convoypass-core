import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { MAX_QUALIFICATION_TYPES, QUALIFICATION_NAME_MAX, type QualificationTypeDef } from '@/lib/requirementLogic'
import { strings } from '@/lib/strings'
import { newQualificationId, qualificationNameOk } from './reasons'

const t = strings.qualifications.settings

/** Add, rename and remove the qualifications every driver must hold (each valid one year). Removing one stops requiring it. */
export function QualificationTypesEditor({ items, onChange, showErrors, usingDefaults }: {
  items: QualificationTypeDef[]
  onChange: (items: QualificationTypeDef[]) => void
  showErrors: boolean
  usingDefaults: boolean
}) {
  const lowered = items.map((i) => i.name.trim().toLowerCase())
  return (
    <section aria-labelledby="qual-title" className="space-y-4">
      <div>
        <h2 id="qual-title" className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-slate-500">{t.hint}</p>
        {usingDefaults && <p className="mt-1 text-sm text-slate-500">{t.usingDefaults}</p>}
      </div>
      {items.length === 0 && <p className="text-sm text-slate-600">{t.none}</p>}
      <ul className="space-y-3">
        {items.map((item, i) => {
          const duplicate = item.name.trim() !== '' && lowered.indexOf(item.name.trim().toLowerCase()) !== i
          return (
            <li key={item.id} className="flex items-end gap-2 rounded-xl border border-slate-200 bg-surface p-4">
              <div className="flex-1">
                <Input
                  label={t.name}
                  value={item.name}
                  maxLength={QUALIFICATION_NAME_MAX}
                  error={showErrors && (!qualificationNameOk(item.name) || duplicate) ? t.nameError : undefined}
                  onChange={(e) => onChange(items.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))}
                />
              </div>
              <Button variant="ghost" size="icon" className="mb-1" aria-label={`${t.remove}: ${item.name}`} onClick={() => onChange(items.filter((_, n) => n !== i))}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </li>
          )
        })}
      </ul>
      <Button variant="secondary" icon={<Plus aria-hidden className="size-4" />} disabled={items.length >= MAX_QUALIFICATION_TYPES} onClick={() => onChange([...items, { id: newQualificationId(), name: '' }])}>
        {t.add}
      </Button>
      {items.length >= MAX_QUALIFICATION_TYPES && <p className="text-xs text-slate-500">{t.max}</p>}
    </section>
  )
}
