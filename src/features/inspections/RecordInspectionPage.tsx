import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CircleX, ShieldOff } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { ListSkeleton, Skeleton } from '@/components/ui/Skeleton'
import { useSession } from '@/features/auth/useAuth'
import { formatDay } from '@/features/penalties/model'
import { useTenantTimezone } from '@/features/penalties/queries'
import { RecordPicker, type PickOption } from '@/features/penalties/RecordPicker'
import { useContractorList, useDrivers, useVehicles } from '@/features/shared/queries'
import { checkEligibility, recordInspection, withdrawClearance } from '@/lib/api'
import { cn } from '@/lib/cn'
import { apiErrorMessage } from '@/lib/errors'
import { newInspectionId } from '@/lib/ids'
import { INSPECTION_NOTES_MAX, REJECTION_NOTE_MIN, type InspectionResult } from '@/lib/inspectionLogic'
import { strings } from '@/lib/strings'
import type { BlockingPenaltyInfo, EligibilityResult } from '@/types/penalties'
import type { Vehicle, WithId } from '@/types'
import { GatePassSection } from '@/features/gatePasses/GatePassSection'
import { ClearanceBadge } from './ClearanceBadge'
import { InspectionHistory } from './InspectionHistory'
import { clearanceOfVehicle } from './model'

const t = strings.inspections.record

/** Vehicles that need a decision first, then the rest by plate (the list is already ordered by plate). */
const PRIORITY = { needs_reinspection: 0, rejected: 1, never_inspected: 2, cleared: 3 } as const

const MAX_DRIVER_CHECKS = 10

/** Approve / reject as a two-choice control: words and icons, never colour alone. */
function ResultToggle({ value, onChange, disabled }: { value: InspectionResult; onChange: (v: InspectionResult) => void; disabled: boolean }) {
  const name = useId()
  const options = [
    { value: 'approved', label: t.approve, Icon: CircleCheck, on: 'bg-success-strong text-on-solid' },
    { value: 'rejected', label: t.reject, Icon: CircleX, on: 'bg-danger-strong text-on-solid' },
  ] as const
  return (
    <fieldset disabled={disabled} className="space-y-1.5">
      <legend className="text-sm font-medium text-slate-700">{t.resultLegend}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-300 bg-slate-100 p-1">
        {options.map(({ value: v, label, Icon, on }) => (
          <label
            key={v}
            className={cn(
              'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
              value === v ? on : 'text-slate-700 hover:bg-surface',
            )}
          >
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="sr-only" />
            <Icon aria-hidden className="size-4" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

const until = (p: BlockingPenaltyInfo, tz: string): string | null => (p.endDate === null ? null : formatDay(p.endDate, tz))

/**
 * What the officer should look at before deciding: active penalties and expired documents of the vehicle and of the
 * drivers assigned to it (a penalty or lapsed licence of any of them is what cancels a clearance). Read from the same
 * live `checkEligibility` the gate will use. Advice only: it never blocks the decision.
 */
function Checks({ vehicle, driverNames, tz }: { vehicle: WithId<Vehicle>; driverNames: Map<string, string>; tz: string }) {
  const { claims } = useSession()
  const driverIds = vehicle.assignedDriverIds.slice(0, MAX_DRIVER_CHECKS)
  const own = useQuery({
    queryKey: ['eligibility', claims.tenantId, 'vehicle', vehicle.id],
    staleTime: 0,
    queryFn: () => checkEligibility({ vehicleId: vehicle.id }),
  })
  const drivers = useQueries({
    queries: driverIds.map((id) => ({
      queryKey: ['eligibility', claims.tenantId, 'driver', id],
      staleTime: 0,
      queryFn: () => checkEligibility({ driverId: id }),
    })),
  })

  const lines = useMemo(() => {
    const out: string[] = []
    const seen = new Set<string>()
    const add = (res: EligibilityResult | undefined) => res?.vehicle?.penalties.forEach((p) => {
      if (seen.has(p.id)) return
      seen.add(p.id)
      out.push(t.penalty(p.typeName, until(p, tz)))
    })
    add(own.data)
    if (own.data?.vehicle?.documentStatus === 'expired') out.push(t.documentsExpired)
    drivers.forEach((q, i) => {
      const who = driverNames.get(driverIds[i] ?? '') ?? strings.common.none
      q.data?.driver?.penalties.forEach((p) => {
        if (seen.has(p.id)) return
        seen.add(p.id)
        out.push(t.penaltyOf(who, p.typeName, until(p, tz)))
      })
      if (q.data?.driver?.documentStatus === 'expired') out.push(t.licenceExpired(who))
    })
    return out
  }, [own.data, drivers, driverIds, driverNames, tz])

  if (own.isPending || drivers.some((q) => q.isPending)) return <Skeleton className="h-12 w-full" aria-label={t.checking} />
  if (own.isError) return <NotificationBanner tone="warning">{t.checkFailed}</NotificationBanner>
  return lines.length === 0 ? (
    <NotificationBanner tone="success">{t.noIssues}</NotificationBanner>
  ) : (
    <NotificationBanner tone="warning" title={t.checks}>
      <ul className="list-disc space-y-0.5 pl-4">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </NotificationBanner>
  )
}

function WithdrawDialog({ vehicle, open, onClose, onDone }: { vehicle: WithId<Vehicle>; open: boolean; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await withdrawClearance({ vehicleId: vehicle.id, note: note.trim() })
      toast.success(t.withdrawnToast(vehicle.plateNo))
      setNote('')
      onDone()
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.withdrawTitle(vehicle.plateNo)}
      variant="sheet"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={busy} disabled={note.trim().length === 0}>
            {t.withdrawConfirm}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{t.withdrawBody}</p>
        <Textarea label={t.withdrawReason} hint={t.withdrawReasonHint} value={note} onChange={(e) => setNote(e.target.value)} maxLength={INSPECTION_NOTES_MAX} rows={3} />
      </div>
    </Modal>
  )
}

/**
 * Safety Officer: pick a vehicle, see where its clearance stands and why, then approve or reject it. An approval is a NEW
 * record that supersedes the old one. The id is chosen here and changes whenever the inputs change, so only a plain
 * retry of the same decision is treated as the same inspection.
 */
export default function RecordInspectionPage() {
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const vehicles = useVehicles('admin')
  const drivers = useDrivers('admin')
  const contractors = useContractorList('admin')
  const tz = useTenantTimezone()

  const [vehicleId, setVehicleId] = useState<string | null>(params.get('vehicle'))
  const [result, setResult] = useState<InspectionResult>('approved')
  const [notes, setNotes] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const inspectionId = useRef(newInspectionId())

  const contractorNames = useMemo(() => new Map((contractors.data ?? []).map((c) => [c.id, c.name])), [contractors.data])
  const driverNames = useMemo(() => new Map((drivers.data?.items ?? []).map((d) => [d.id, d.name])), [drivers.data])
  const list = vehicles.data?.items
  const vehicle = list?.find((v) => v.id === vehicleId) ?? null

  const options: PickOption[] = useMemo(
    () =>
      (list ?? [])
        .map((v) => ({ v, c: clearanceOfVehicle(v) }))
        .sort((a, b) => PRIORITY[a.c.status] - PRIORITY[b.c.status])
        .map(({ v, c }) => ({
          id: v.id,
          label: v.plateNo,
          hint: [v.type, contractorNames.get(v.contractorId)].filter(Boolean).join(' · '),
          search: `${v.plateKey} ${v.makeModel ?? ''} ${contractorNames.get(v.contractorId) ?? ''}`,
          flag: c.status === 'needs_reinspection' || c.status === 'rejected' ? strings.inspections.clearance[c.status] : undefined,
        })),
    [list, contractorNames],
  )

  const changed = () => {
    inspectionId.current = newInspectionId()
  }
  const noteTooShort = result === 'rejected' && notes.trim().length < REJECTION_NOTE_MIN

  const refresh = () =>
    Promise.all(['vehicles', 'inspections', 'reinspection', 'eligibility'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))

  const submit = async () => {
    if (!vehicle) return
    if (noteTooShort) {
      setShowErrors(true)
      return
    }
    setBusy(true)
    try {
      await recordInspection({ inspectionId: inspectionId.current, vehicleId: vehicle.id, result, notes: notes.trim() })
      await refresh()
      toast.success(result === 'approved' ? t.approvedToast(vehicle.plateNo) : t.rejectedToast(vehicle.plateNo))
      setVehicleId(null)
      setNotes('')
      setResult('approved')
      setShowErrors(false)
      changed()
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const clearance = vehicle ? clearanceOfVehicle(vehicle) : null

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{t.subtitle}</p>
      </div>

      {vehicles.isPending ? (
        <ListSkeleton />
      ) : vehicles.isError ? (
        <ErrorState error={vehicles.error} onRetry={() => void vehicles.refetch()} />
      ) : (
        <>
          <RecordPicker
            legend={t.vehicle}
            searchLabel={t.searchLabel}
            options={options}
            value={vehicle?.id ?? null}
            onChange={(id) => {
              setVehicleId(id)
              changed()
            }}
            emptyText={t.noVehicles}
            noMatchText={t.noMatch}
            disabled={busy}
          />

          {!vehicle || !clearance ? (
            <p className="text-sm text-slate-600">{t.pickFirst}</p>
          ) : (
            <div className="space-y-5">
              <section aria-label={t.current} className="space-y-3 rounded-xl border border-slate-200 bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">{t.current}</h2>
                  <ClearanceBadge clearance={clearance} />
                </div>
                {clearance.status === 'needs_reinspection' && clearance.reason && (
                  <p className="text-sm text-slate-700">{strings.inspections.reasonDetail[clearance.reason]}</p>
                )}
                {clearance.status === 'never_inspected' && <p className="text-sm text-slate-700">{t.neverInspected}</p>}
                {clearance.status === 'cleared' && (
                  <Button variant="secondary" size="sm" icon={<ShieldOff aria-hidden className="size-4" />} onClick={() => setWithdrawing(true)} disabled={busy}>
                    {t.withdraw}
                  </Button>
                )}
              </section>

              <Checks vehicle={vehicle} driverNames={driverNames} tz={tz} />

              {/* Read only: a restored clearance does not bring a blocked pass back, the Company Admin reactivates it. */}
              <GatePassSection scope="admin" field="vehicleId" id={vehicle.id} />

              <form
                className="space-y-4"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault()
                  void submit()
                }}
              >
                <ResultToggle
                  value={result}
                  onChange={(v) => {
                    setResult(v)
                    changed()
                  }}
                  disabled={busy}
                />
                <Textarea
                  label={t.notes}
                  hint={result === 'rejected' ? t.notesRejectHint : t.notesApproveHint}
                  error={showErrors && noteTooShort ? t.notesRequired : undefined}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value)
                    changed()
                  }}
                  maxLength={INSPECTION_NOTES_MAX}
                  rows={4}
                  disabled={busy}
                />
                <Button type="submit" className="w-full sm:w-auto" variant={result === 'approved' ? 'primary' : 'danger'} loading={busy}>
                  {result === 'approved' ? t.submitApprove : t.submitReject}
                </Button>
              </form>

              <InspectionHistory scope="admin" vehicleId={vehicle.id} />
              <WithdrawDialog
                vehicle={vehicle}
                open={withdrawing}
                onClose={() => setWithdrawing(false)}
                onDone={() => {
                  setWithdrawing(false)
                  void refresh()
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
