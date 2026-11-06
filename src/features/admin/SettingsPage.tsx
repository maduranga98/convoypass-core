import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { updateTenantSettings } from '@/lib/api'
import { DEFAULT_TIMEZONE } from '@/lib/dates'
import {
  DEFAULT_CHECKLIST,
  DEFAULT_PASS_SETTINGS,
  type ChecklistItemDef,
  type PassSettings,
} from '@/lib/defaultChecklist'
import { DEFAULT_REJECTION_REASONS, type RejectionReasonDef } from '@/lib/defaultRejectionReasons'
import { slaOf, type SlaSettings } from '@/lib/defaultSla'
import { DEFAULT_EXPIRY_WARNING_DAYS } from '@/lib/expiry'
import { effectiveQualificationTypes, type QualificationTypeDef } from '@/lib/requirementLogic'
import { effectiveVehicleTypes } from '@/lib/vehicleTypes'
import { dwellLimitHoursOf, dwellLimitOk } from '@/lib/visitLogic'
import { DEFAULT_GATES, MIN_GATES, type GateDef } from '@/lib/gates'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { markSettingsVisited } from '@/features/onboarding/storage'
import { useTenant } from '@/features/passes/queries'
import { useVehicles } from '@/features/shared/queries'
import type { Tenant } from '@/types'
import { expiryDaysOk, gateNameOk, MAX_REASONS, MIN_REASONS, reasonLabelOk, qualificationTypesOk, retentionOk, slaOk, vehicleTypesOk } from './reasons'
import { RejectionReasonsEditor } from './RejectionReasonsEditor'
import { GatesEditor } from './GatesEditor'
import { RetentionEditor } from './RetentionEditor'
import { SlaEditor } from './SlaEditor'
import { DwellEditor } from './DwellEditor'
import { ExpiryEditor } from './ExpiryEditor'
import { VehicleTypesEditor } from './VehicleTypesEditor'
import { QualificationTypesEditor } from './QualificationTypesEditor'
import { AdminsCard } from './AdminsCard'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.admin.settings
const MAX_ITEMS = 12

const TABS = ['passes', 'gate', 'fleet', 'workspace'] as const
type TabId = (typeof TABS)[number]
const isTab = (v: string | null): v is TabId => TABS.some((x) => x === v)

/** Ids are generated once, when an item is added, and never edited: passes keep answers by id. */
const newId = (): string => `custom_${Math.random().toString(36).slice(2, 8)}`
const labelOk = (label: string): boolean => label.trim().length >= 3 && label.trim().length <= 60

interface Baseline {
  checklist: ChecklistItemDef[]
  settings: PassSettings
  reasons: RejectionReasonDef[]
  gates: GateDef[]
  sla: SlaSettings
  retentionDays: number
  vehicleTypes: string[]
  expiryWarningDays: number
  dwellLimitHours: number
  qualificationTypes: QualificationTypeDef[]
}

const baselineOf = (tenant: Tenant | null): Baseline => ({
  checklist: tenant?.checklist && tenant.checklist.length > 0 ? tenant.checklist : [...DEFAULT_CHECKLIST],
  settings: { ...DEFAULT_PASS_SETTINGS, ...tenant?.passSettings },
  reasons: tenant?.rejectionReasons && tenant.rejectionReasons.length > 0 ? tenant.rejectionReasons : [...DEFAULT_REJECTION_REASONS],
  gates: tenant?.gates && tenant.gates.length > 0 ? tenant.gates : [...DEFAULT_GATES],
  sla: slaOf(tenant),
  retentionDays: tenant?.retentionDays ?? 0,
  vehicleTypes: effectiveVehicleTypes(tenant?.vehicleTypes),
  expiryWarningDays: tenant?.expiryWarningDays ?? DEFAULT_EXPIRY_WARNING_DAYS,
  dwellLimitHours: dwellLimitHoursOf(tenant),
  qualificationTypes: effectiveQualificationTypes(tenant?.qualificationTypes),
})

function SettingsForm({ tenant, tenantId }: { tenant: Tenant | null; tenantId: string }) {
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: TabId = isTab(requested) ? requested : 'passes'
  const selectTab = (next: TabId) => setParams({ tab: next }, { replace: true })
  const queryClient = useQueryClient()
  const usingDefaults = !tenant?.checklist || tenant.checklist.length === 0
  const [baseline, setBaseline] = useState<Baseline>(() => baselineOf(tenant))
  const [items, setItems] = useState<ChecklistItemDef[]>(baseline.checklist)
  const [settings, setSettings] = useState<PassSettings>(baseline.settings)
  const [reasons, setReasons] = useState<RejectionReasonDef[]>(baseline.reasons)
  const usingDefaultReasons = !tenant?.rejectionReasons || tenant.rejectionReasons.length === 0
  const [gates, setGates] = useState<GateDef[]>(baseline.gates)
  const usingDefaultGates = !tenant?.gates || tenant.gates.length === 0
  const [sla, setSla] = useState<SlaSettings>(baseline.sla)
  const usingDefaultSla = !tenant?.sla
  const [retention, setRetention] = useState<number>(baseline.retentionDays)
  const [types, setTypes] = useState<string[]>(baseline.vehicleTypes)
  const usingDefaultTypes = !tenant?.vehicleTypes || tenant.vehicleTypes.length === 0
  const [warnDays, setWarnDays] = useState<number>(baseline.expiryWarningDays)
  const [dwellHours, setDwellHours] = useState<number>(baseline.dwellLimitHours)
  const [qualTypes, setQualTypes] = useState<QualificationTypeDef[]>(baseline.qualificationTypes)
  const usingDefaultQuals = tenant?.qualificationTypes === undefined
  const vehicles = useVehicles('admin')
  const typesInUse = new Set((vehicles.data?.items ?? []).map((v) => v.type))
  const [confirmRetention, setConfirmRetention] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const dirty =
    JSON.stringify({ items, settings, reasons, gates, sla, retention, types, warnDays, dwellHours, qualTypes }) !==
    JSON.stringify({ items: baseline.checklist, settings: baseline.settings, reasons: baseline.reasons, gates: baseline.gates, sla: baseline.sla, retention: baseline.retentionDays, types: baseline.vehicleTypes, warnDays: baseline.expiryWarningDays, dwellHours: baseline.dwellLimitHours, qualTypes: baseline.qualificationTypes })
  const qualChanged = JSON.stringify(qualTypes) !== JSON.stringify(baseline.qualificationTypes)
  const retentionChanged = !Object.is(retention, baseline.retentionDays)
  const slaChanged = JSON.stringify(sla) !== JSON.stringify(baseline.sla)
  const reasonsChanged = JSON.stringify(reasons) !== JSON.stringify(baseline.reasons)
  const gatesChanged = JSON.stringify(gates) !== JSON.stringify(baseline.gates)
  const typesChanged = JSON.stringify(types) !== JSON.stringify(baseline.vehicleTypes)
  const warnChanged = warnDays !== baseline.expiryWarningDays
  const dwellChanged = dwellHours !== baseline.dwellLimitHours
  const documentsBad = !vehicleTypesOk(types) || !expiryDaysOk(warnDays) || !dwellLimitOk(dwellHours) || !qualificationTypesOk(qualTypes)
  const invalidLabels =
    items.some((i) => !labelOk(i.label)) || reasons.some((r) => !reasonLabelOk(r.label)) || gates.some((g) => !gateNameOk(g.name))
  const reasonCountBad = reasons.length < MIN_REASONS || reasons.length > MAX_REASONS || gates.length < MIN_GATES
  const problem = items.length === 0 ? t.needOne : null
  const tabProblem: Record<TabId, boolean> = {
    passes: items.some((i) => !labelOk(i.label)) || items.length === 0 || reasons.some((r) => !reasonLabelOk(r.label)) || reasons.length < MIN_REASONS || reasons.length > MAX_REASONS,
    gate: gates.some((g) => !gateNameOk(g.name)) || gates.length < MIN_GATES || !slaOk(sla) || !dwellLimitOk(dwellHours),
    fleet: !vehicleTypesOk(types) || !expiryDaysOk(warnDays) || !qualificationTypesOk(qualTypes),
    workspace: !retentionOk(retention),
  }
  const discard = () => {
    setItems(baseline.checklist)
    setSettings(baseline.settings)
    setReasons(baseline.reasons)
    setGates(baseline.gates)
    setSla(baseline.sla)
    setRetention(baseline.retentionDays)
    setTypes(baseline.vehicleTypes)
    setWarnDays(baseline.expiryWarningDays)
    setDwellHours(baseline.dwellLimitHours)
    setQualTypes(baseline.qualificationTypes)
    setTouched(false)
    setError(null)
  }
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = TABS[(index + step + TABS.length) % TABS.length]
    if (next) {
      selectTab(next)
      document.getElementById(`settings-tab-${next}`)?.focus()
    }
  }

  const update = (index: number, patch: Partial<ChecklistItemDef>) =>
    setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  const move = (index: number, by: -1 | 1) =>
    setItems((list) => {
      const target = index + by
      if (target < 0 || target >= list.length) return list
      const next = [...list]
      const [moved] = next.splice(index, 1)
      if (moved) next.splice(target, 0, moved)
      return next
    })

  // Turning deletion on, or shortening the limit, asks first: it removes photos for good.
  const askOrSave = () => {
    setTouched(true)
    if (invalidLabels || problem || reasonCountBad || documentsBad || !slaOk(sla) || !retentionOk(retention)) return
    if (retentionChanged && retention !== 0 && (baseline.retentionDays === 0 || retention < baseline.retentionDays)) setConfirmRetention(true)
    else void save()
  }

  const save = async () => {
    setConfirmRetention(false)
    setTouched(true)
    if (invalidLabels || problem || reasonCountBad || documentsBad || !slaOk(sla) || !retentionOk(retention)) return
    setSaving(true)
    setError(null)
    const checklist = items.map((i) => ({ ...i, label: i.label.trim() }))
    const cleanReasons = reasons.map((r) => ({ ...r, label: r.label.trim() }))
    const cleanGates = gates.map((g) => ({ ...g, name: g.name.trim() }))
    const cleanTypes = types.map((n) => n.trim())
    const cleanQuals = qualTypes.map((q) => ({ id: q.id, name: q.name.trim() }))
    try {
      // The default reasons are only written once the admin actually changes them (or already has their own).
      const saveReasons = reasonsChanged || !usingDefaultReasons
      const saveGates = gatesChanged || !usingDefaultGates
      await updateTenantSettings({
        passSettings: settings,
        checklist,
        ...(saveReasons ? { rejectionReasons: cleanReasons } : {}),
        ...(saveGates ? { gates: cleanGates } : {}),
        ...(slaChanged || !usingDefaultSla ? { sla } : {}),
        ...(retentionChanged ? { retentionDays: retention } : {}),
        ...(typesChanged ? { vehicleTypes: cleanTypes } : {}),
        ...(warnChanged ? { expiryWarningDays: warnDays } : {}),
        ...(dwellChanged ? { dwellLimitHours: dwellHours } : {}),
        ...(qualChanged ? { qualificationTypes: cleanQuals } : {}),
      })
      setItems(checklist)
      setReasons(cleanReasons)
      setGates(cleanGates)
      setTypes(cleanTypes)
      setQualTypes(cleanQuals)
      setBaseline({ checklist, settings, reasons: cleanReasons, gates: cleanGates, sla, retentionDays: retention, vehicleTypes: cleanTypes, expiryWarningDays: warnDays, dwellLimitHours: dwellHours, qualificationTypes: cleanQuals })
      await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] })
      toast.success(t.saved)
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="-mx-1 overflow-x-auto px-1">
        <div role="tablist" aria-label={t.tabsLabel} className="flex min-w-max gap-1 border-b border-slate-200">
          {TABS.map((id, index) => {
            const active = id === tab
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`settings-tab-${id}`}
                aria-selected={active}
                aria-controls={`settings-panel-${id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => selectTab(id)}
                onKeyDown={(e) => onTabKey(e, index)}
                className={`-mb-px flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-medium outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-focus ${active ? 'border-accent text-ink' : 'border-transparent text-slate-500 hover:text-ink'}`}
              >
                {t.tabs[id]}
                {touched && tabProblem[id] && (
                  <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger-ink">{t.needsAttention}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`} className="space-y-6">
        <p className="text-sm text-slate-500">{t.tabHints[tab]}</p>
        {tab === 'passes' && (
          <>
      <section aria-labelledby="chk-title" className="space-y-4">
        <div>
          <h2 id="chk-title" className="text-lg font-semibold">{t.checklistTitle}</h2>
          <p className="text-sm text-slate-500">{t.checklistHint}</p>
          {usingDefaults && <p className="mt-1 text-sm text-slate-500">{t.usingDefaults}</p>}
        </div>

        <ul className="space-y-3">
          {items.map((item, i) => (
            <li key={item.id} className="space-y-3 rounded-xl border border-slate-200 bg-surface p-4">
              <Input
                label={t.label}
                value={item.label}
                maxLength={60}
                error={touched && !labelOk(item.label) ? t.labelError : undefined}
                onChange={(e) => update(i, { label: e.target.value })}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand"
                    checked={item.failBlocks}
                    onChange={(e) => update(i, { failBlocks: e.target.checked })}
                  />
                  <span><span className="font-medium">{t.blocks}</span> <span className="text-slate-500">· {t.blocksHint}</span></span>
                </label>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={`${t.moveUp}: ${item.label}`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`${t.moveDown}: ${item.label}`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`${t.remove}: ${item.label}`} onClick={() => setItems((l) => l.filter((_, n) => n !== i))}>
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}

        <Button
          variant="secondary"
          icon={<Plus aria-hidden className="size-4" />}
          disabled={items.length >= MAX_ITEMS}
          onClick={() => setItems((l) => [...l, { id: newId(), label: '', failBlocks: false }])}
        >
          {t.add}
        </Button>
        {items.length >= MAX_ITEMS && <p className="text-xs text-slate-500">{t.max}</p>}
      </section>

      <RejectionReasonsEditor items={reasons} onChange={setReasons} showErrors={touched} usingDefaults={usingDefaultReasons} />
      <section aria-labelledby="opts-title" className="space-y-4 rounded-xl border border-slate-200 bg-surface p-4">
        <h2 id="opts-title" className="text-lg font-semibold">{t.passOptionsTitle}</h2>
        <label className="flex min-h-10 items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-brand"
            checked={settings.requireLocation}
            onChange={(e) => setSettings((s) => ({ ...s, requireLocation: e.target.checked }))}
          />
          <span><span className="font-medium">{t.requireLocation}</span><br /><span className="text-slate-500">{t.requireLocationHint}</span></span>
        </label>
        <Select
          label={t.maxExtra}
          value={String(settings.maxExtraPhotos)}
          onChange={(e) => setSettings((s) => ({ ...s, maxExtraPhotos: Number(e.target.value) }))}
        >
          {[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
      </section>

          </>
        )}
        {tab === 'gate' && (
          <>
      <GatesEditor items={gates} onChange={setGates} showErrors={touched} usingDefaults={usingDefaultGates} />
      <DwellEditor value={dwellHours} onChange={setDwellHours} showErrors={touched} />
      <SlaEditor value={sla} onChange={setSla} showErrors={touched} usingDefaults={usingDefaultSla} />
          </>
        )}
        {tab === 'fleet' && (
          <>
      <VehicleTypesEditor
        items={types}
        saved={baseline.vehicleTypes}
        inUse={typesInUse}
        onChange={setTypes}
        showErrors={touched}
        usingDefaults={usingDefaultTypes && !typesChanged}
      />

      <ExpiryEditor value={warnDays} onChange={setWarnDays} showErrors={touched} />
      <QualificationTypesEditor items={qualTypes} onChange={setQualTypes} showErrors={touched} usingDefaults={usingDefaultQuals && !qualChanged} />
          </>
        )}
        {tab === 'workspace' && (
          <>
      <section aria-labelledby="tz-title" className="space-y-4 rounded-xl border border-slate-200 bg-surface p-4">
        <h2 id="tz-title" className="text-lg font-semibold">{t.timezone}</h2>
        <Input label={t.timezone} value={tenant?.timezone ?? DEFAULT_TIMEZONE} readOnly hint={t.timezoneHint} />
      </section>
      <RetentionEditor value={retention} onChange={setRetention} showErrors={touched} />
            <AdminsCard />
          </>
        )}
      </div>

      {error && <NotificationBanner tone="error">{error}</NotificationBanner>}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-surface p-3 shadow-sm">
        <p role="status" className="text-sm text-slate-600">{dirty ? t.unsaved : t.allSaved}</p>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={!dirty || saving} onClick={discard}>{t.discard}</Button>
          <Button loading={saving} disabled={!dirty} onClick={askOrSave}>
            {saving ? strings.common.saving : t.save}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmRetention}
        title={strings.retention.confirmTitle}
        body={strings.retention.confirmBody(retention)}
        confirmLabel={strings.retention.confirm}
        tone="danger"
        onConfirm={() => void save()}
        onCancel={() => setConfirmRetention(false)}
      />
    </div>
  )
}

export default function SettingsPage() {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  // The onboarding checklist's last step: the admin has looked at the defaults (remembered on this device).
  useEffect(() => {
    markSettingsVisited(claims.tenantId)
  }, [claims.tenantId])

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
      </div>
      {tenant.isPending ? (
        <div role="status" className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : tenant.isError ? (
        <ErrorState message={t.loadFailed} error={tenant.error} onRetry={() => void tenant.refetch()} />
      ) : (
        <SettingsForm tenant={tenant.data} tenantId={claims.tenantId} />
      )}
    </div>
  )
}
