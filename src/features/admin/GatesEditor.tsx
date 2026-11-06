import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { GATE_NAME_MAX, MAX_GATES, MIN_GATES, type GateDef } from '@/lib/gates'
import { strings } from '@/lib/strings'
import { gateNameOk, newGateId } from './reasons'

const t = strings.admin.gates


/** Add, rename and remove gates. At least one always remains. */
export function GatesEditor({ items, onChange, showErrors, usingDefaults }: {
  items: GateDef[]
  onChange: (items: GateDef[]) => void
  showErrors: boolean
  usingDefaults: boolean
}) {
  return (
    <section aria-labelledby="gates-title" className="space-y-4">
      <div>
        <h2 id="gates-title" className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-slate-500">{t.hint}</p>
        {usingDefaults && <p className="mt-1 text-sm text-slate-500">{t.usingDefaults}</p>}
      </div>
      <ul className="space-y-3">
        {items.map((g, i) => (
          <li key={g.id} className="flex items-end gap-2 rounded-xl border border-slate-200 bg-surface p-4">
            <div className="flex-1">
              <Input
                label={t.name}
                value={g.name}
                maxLength={GATE_NAME_MAX}
                error={showErrors && !gateNameOk(g.name) ? t.nameError : undefined}
                onChange={(e) => onChange(items.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="mb-1"
              aria-label={`${t.remove}: ${g.name}`}
              disabled={items.length <= MIN_GATES}
              onClick={() => onChange(items.filter((_, n) => n !== i))}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      {items.length < MIN_GATES && <p role="alert" className="text-sm text-danger">{t.min}</p>}
      <Button
        variant="secondary"
        icon={<Plus aria-hidden className="size-4" />}
        disabled={items.length >= MAX_GATES}
        onClick={() => onChange([...items, { id: newGateId(), name: '' }])}
      >
        {t.add}
      </Button>
      {items.length >= MAX_GATES && <p className="text-xs text-slate-500">{t.max}</p>}
    </section>
  )
}
