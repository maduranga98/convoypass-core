import { Input } from '@/components/ui/Input'
import { strings } from '@/lib/strings'
import { DEFAULT_RETENTION_DAYS, RETENTION_MAX, RETENTION_MIN, retentionOk } from './reasons'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.retention

/** Evidence retention. Off by default; the warning is always visible because deletion cannot be undone. */
export function RetentionEditor({ value, onChange, showErrors }: { value: number; onChange: (days: number) => void; showErrors: boolean }) {
  const on = value !== 0
  return (
    <section aria-labelledby="retention-title" className="space-y-4">
      <div>
        <h2 id="retention-title" className="text-lg font-semibold">{t.title}</h2>
        <p className="text-sm text-slate-600">{t.intro}</p>
      </div>
      <div className="space-y-4 rounded-xl border border-slate-200 bg-surface p-4">
        <fieldset className="space-y-2">
          <legend className="sr-only">{t.title}</legend>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="radio" name="retention" className="size-5 accent-brand" checked={!on} onChange={() => onChange(0)} />
            {t.keep}
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="radio" name="retention" className="size-5 accent-brand" checked={on} onChange={() => onChange(on ? value : DEFAULT_RETENTION_DAYS)} />
            {t.removeAfter}
          </label>
        </fieldset>
        {on && (
          <Input
            label={`${t.removeAfter} (${t.days})`}
            type="number"
            inputMode="numeric"
            min={RETENTION_MIN}
            max={RETENTION_MAX}
            step={1}
            value={Number.isNaN(value) ? '' : String(value)}
            error={showErrors && !retentionOk(value) ? t.range : undefined}
            onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
          />
        )}
        <NotificationBanner tone="warning" role="note">{t.warning}</NotificationBanner>
      </div>
    </section>
  )
}
