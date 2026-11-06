import { Input } from '@/components/ui/Input'
import { SLA_MAX, SLA_MIN, type SlaSettings } from '@/lib/defaultSla'
import { strings } from '@/lib/strings'
import { minutesOk } from './reasons'

const t = strings.admin.sla

/** How long a pass may wait at each review step before the dashboard flags it. */
export function SlaEditor({ value, onChange, showErrors, usingDefaults }: {
  value: SlaSettings
  onChange: (sla: SlaSettings) => void
  showErrors: boolean
  usingDefaults: boolean
}) {
  const field = (label: string, key: keyof SlaSettings) => (
    <Input
      label={label}
      type="number"
      inputMode="numeric"
      min={SLA_MIN}
      max={SLA_MAX}
      step={1}
      value={Number.isNaN(value[key]) ? '' : String(value[key])}
      error={showErrors && !minutesOk(value[key]) ? t.error : undefined}
      onChange={(e) => onChange({ ...value, [key]: e.target.value === '' ? NaN : Number(e.target.value) })}
    />
  )
  return (
    <section aria-labelledby="sla-title" className="space-y-4">
      <div>
        <h2 id="sla-title" className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-slate-500">{t.hint}</p>
        {usingDefaults && <p className="mt-1 text-sm text-slate-500">{t.usingDefaults}</p>}
      </div>
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-surface p-4 sm:grid-cols-2">
        {field(t.supervisor, 'supervisorMinutes')}
        {field(t.officer, 'officerMinutes')}
      </div>
    </section>
  )
}
