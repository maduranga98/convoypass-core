import { Input } from '@/components/ui/Input'
import { strings } from '@/lib/strings'
import { MAX_DWELL_LIMIT_HOURS, MIN_DWELL_LIMIT_HOURS, dwellLimitOk } from '@/lib/visitLogic'

const t = strings.visits.settings

/** The company's dwell limit in hours (default 16). A warning only: the dwell job flags the visit, nothing is blocked. */
export function DwellEditor({ value, onChange, showErrors }: { value: number; onChange: (n: number) => void; showErrors: boolean }) {
  return (
    <section aria-labelledby="dwell-title" className="space-y-4">
      <div>
        <h2 id="dwell-title" className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-slate-500">{t.intro}</p>
      </div>
      <div className="max-w-60">
        <Input
          label={t.label}
          type="number"
          inputMode="numeric"
          min={MIN_DWELL_LIMIT_HOURS}
          max={MAX_DWELL_LIMIT_HOURS}
          value={Number.isNaN(value) ? '' : value}
          hint={t.hint(MIN_DWELL_LIMIT_HOURS, MAX_DWELL_LIMIT_HOURS)}
          error={showErrors && !dwellLimitOk(value) ? t.hint(MIN_DWELL_LIMIT_HOURS, MAX_DWELL_LIMIT_HOURS) : undefined}
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
        />
      </div>
    </section>
  )
}
