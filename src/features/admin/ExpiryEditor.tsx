import { Input } from '@/components/ui/Input'
import { MAX_EXPIRY_WARNING_DAYS, MIN_EXPIRY_WARNING_DAYS } from '@/lib/expiry'
import { strings } from '@/lib/strings'
import { expiryDaysOk } from './reasons'

const t = strings.admin.expiry

/** How many days ahead a vehicle or driver turns "Expiring soon". */
export function ExpiryEditor({ value, onChange, showErrors }: { value: number; onChange: (n: number) => void; showErrors: boolean }) {
  return (
    <section aria-labelledby="expiry-title" className="space-y-4">
      <div>
        <h2 id="expiry-title" className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-slate-500">{t.hint}</p>
      </div>
      <div className="max-w-60">
        <Input
          label={t.days}
          type="number"
          inputMode="numeric"
          min={MIN_EXPIRY_WARNING_DAYS}
          max={MAX_EXPIRY_WARNING_DAYS}
          value={Number.isNaN(value) ? '' : value}
          error={showErrors && !expiryDaysOk(value) ? t.error : undefined}
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
        />
      </div>
    </section>
  )
}
