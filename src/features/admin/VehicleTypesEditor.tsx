import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { MAX_VEHICLE_TYPES, VEHICLE_TYPE_NAME_MAX } from '@/lib/vehicleTypes'
import { strings } from '@/lib/strings'
import { vehicleTypeNameOk } from './reasons'

const t = strings.admin.vehicleTypes

/**
 * Add, rename and remove vehicle types. Vehicles keep the type name, so a saved name that a vehicle uses is locked
 * (the server refuses removing or renaming it as well).
 */
export function VehicleTypesEditor({ items, saved, inUse, onChange, showErrors, usingDefaults }: {
  items: string[]
  /** Names as last saved: only these can be in use. */
  saved: string[]
  inUse: ReadonlySet<string>
  onChange: (items: string[]) => void
  showErrors: boolean
  usingDefaults: boolean
}) {
  const lowered = items.map((n) => n.trim().toLowerCase())
  return (
    <section aria-labelledby="types-title" className="space-y-4">
      <div>
        <h2 id="types-title" className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-slate-500">{t.hint}</p>
        {usingDefaults && <p className="mt-1 text-sm text-slate-500">{t.usingDefaults}</p>}
      </div>
      <ul className="space-y-3">
        {items.map((name, i) => {
          const locked = saved.includes(name) && inUse.has(name)
          const duplicate = name.trim() !== '' && lowered.indexOf(name.trim().toLowerCase()) !== i
          return (
            <li key={i} className="flex items-end gap-2 rounded-xl border border-slate-200 bg-surface p-4">
              <div className="flex-1">
                <Input
                  label={t.name}
                  value={name}
                  maxLength={VEHICLE_TYPE_NAME_MAX}
                  readOnly={locked}
                  hint={locked ? t.inUse : undefined}
                  error={showErrors && (!vehicleTypeNameOk(name) || duplicate) ? t.nameError : undefined}
                  onChange={(e) => onChange(items.map((x, n) => (n === i ? e.target.value : x)))}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="mb-1"
                aria-label={`${t.remove}: ${name}`}
                disabled={items.length <= 1 || locked}
                onClick={() => onChange(items.filter((_, n) => n !== i))}
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </li>
          )
        })}
      </ul>
      {items.length < 1 && <p role="alert" className="text-sm text-danger">{t.min}</p>}
      <Button
        variant="secondary"
        icon={<Plus aria-hidden className="size-4" />}
        disabled={items.length >= MAX_VEHICLE_TYPES}
        onClick={() => onChange([...items, ''])}
      >
        {t.add}
      </Button>
      {items.length >= MAX_VEHICLE_TYPES && <p className="text-xs text-slate-500">{t.max}</p>}
    </section>
  )
}
