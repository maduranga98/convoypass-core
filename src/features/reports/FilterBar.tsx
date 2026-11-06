import { formatPhone } from '@/lib/credentials'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useContractorList, useDrivers, useVehicles } from '@/features/shared/queries'
import { strings } from '@/lib/strings'
import { addDays } from './days'
import { EntitySearch } from './EntitySearch'
import { filterProblem, PRESETS, presetRange, type Preset, type ReportFilters } from './filters'

const t = strings.reports.filters
const field = 'h-10 rounded-lg border border-slate-300 bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus'
const label = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function VehicleField({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const vehicles = useVehicles('admin')
  const options = (vehicles.data?.items ?? []).map((v) => ({ id: v.id, label: v.plateNo, hint: v.type }))
  return <EntitySearch label={t.vehicle} placeholder={t.vehiclePlaceholder} options={options} value={value} onChange={onChange} loading={vehicles.isPending} />
}

function DriverField({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const drivers = useDrivers('admin')
  const options = (drivers.data?.items ?? []).map((d) => ({ id: d.id, label: d.name, ...(d.phone ? { hint: formatPhone(d.phone) } : {}) }))
  return <EntitySearch label={t.driver} placeholder={t.driverPlaceholder} options={options} value={value} onChange={onChange} loading={drivers.isPending} />
}

/**
 * Edits a draft; nothing runs until Apply (which writes the URL). Changing a date switches the preset to Custom.
 */
export function FilterBar({ applied, today, onApply }: { applied: ReportFilters; today: string; onApply: (f: ReportFilters) => void }) {
  const [draft, setDraft] = useState<ReportFilters>(applied)
  const contractors = useContractorList('admin')
  const problem = filterProblem(draft)
  const set = (patch: Partial<ReportFilters>) => setDraft((d) => ({ ...d, ...patch }))
  const pickPreset = (preset: Preset) => set(preset === 'custom' ? { preset } : { preset, ...presetRange(preset, today) })
  const message =
    problem === 'range-long' ? t.maxRange : problem === 'range-order' ? t.orderError : problem === 'need-vehicle' ? t.needVehicle : problem === 'need-driver' ? t.needDriver : null
  const rangeProblem = problem === 'range-long' || problem === 'range-order'

  return (
    <form
      aria-label={t.title}
      className="space-y-4 rounded-xl border border-slate-200 bg-surface p-4 print:hidden"
      onSubmit={(e) => {
        e.preventDefault()
        if (!problem) onApply(draft)
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">{t.range}</legend>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={draft.preset === p}
              onClick={() => pickPreset(p)}
              className={`h-9 rounded-full border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-focus ${draft.preset === p ? 'border-brand bg-accent-soft text-ink' : 'border-slate-300 bg-surface text-slate-700 hover:bg-slate-50'}`}
            >
              {t.presets[p]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={label}>
          {t.from}
          <input type="date" value={draft.from} max={addDays(today, 0)} onChange={(e) => set({ from: e.target.value, preset: 'custom' })} className={field} aria-invalid={rangeProblem} />
        </label>
        <label className={label}>
          {t.to}
          <input type="date" value={draft.to} onChange={(e) => set({ to: e.target.value, preset: 'custom' })} className={field} aria-invalid={rangeProblem} />
        </label>
        <label className={label}>
          {t.contractor}
          <select value={draft.contractorId} onChange={(e) => set({ contractorId: e.target.value })} className={field}>
            <option value="">{t.allContractors}</option>
            {(contractors.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {draft.type === 'vehicle_history' && <VehicleField value={draft.vehicleId} onChange={(id) => set({ vehicleId: id })} />}
        {draft.type === 'driver_history' && <DriverField value={draft.driverId} onChange={(id) => set({ driverId: id })} />}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={problem !== null}>{t.apply}</Button>
        {message && <p role="alert" className="text-sm text-danger-strong">{message}</p>}
      </div>
    </form>
  )
}
