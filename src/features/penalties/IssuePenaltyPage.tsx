import { ArrowLeft } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'
import { useContractorList, useDrivers, useVehicles } from '@/features/shared/queries'
import { cn } from '@/lib/cn'
import { dateKey, DEFAULT_TIMEZONE } from '@/lib/dates'
import { apiErrorMessage } from '@/lib/errors'
import { isoFromDateKey } from '@/lib/expiry'
import { newPenaltyId } from '@/lib/ids'
import { issuePenalty } from '@/lib/api'
import { PENALTY_MAX_DAYS, PENALTY_REASON_MAX, PENALTY_REASON_MIN } from '@/lib/penaltyLogic'
import { formatPhone } from '@/lib/credentials'
import { strings } from '@/lib/strings'
import { uploadPhoto } from '@/lib/storage'
import { useBlocked } from './feed'
import { penaltyPhotoPath } from './photo'
import { PenaltyPhotoField } from './PenaltyPhotoField'
import { usePenaltyTypes } from './queries'
import { RecordPicker, type PickOption } from './RecordPicker'

const t = strings.penalties.issue

type Kind = 'driver' | 'vehicle' | 'both'

/** A small accessible segmented choice (native radios). */
function Segmented<V extends string>({ legend, value, options, onChange, disabled }: { legend: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; disabled?: boolean }) {
  const name = useId()
  return (
    <fieldset disabled={disabled} className="space-y-1.5">
      <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      <div className="inline-flex w-full rounded-lg border border-slate-300 bg-slate-100 p-1 sm:w-auto">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'flex h-9 flex-1 cursor-pointer items-center justify-center rounded-md px-4 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus pointer-coarse:h-11 sm:flex-none',
              value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-slate-700',
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Issue a penalty (admin and Safety Officer share this screen). The penalty is in force the moment it is issued; the
 * supervisor's review comes afterwards. A photo, when chosen, is uploaded to the penalty's own Storage path first and the
 * server re-checks it; the penalty id is chosen here so a failed call can be retried safely.
 */
export default function IssuePenaltyPage({ listPath, typesPath }: { listPath: string; typesPath: string | null }) {
  const navigate = useNavigate()
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const types = usePenaltyTypes()
  const vehicles = useVehicles('admin')
  const drivers = useDrivers('admin')
  const contractors = useContractorList('admin')
  const blocked = useBlocked('admin')

  const [kind, setKind] = useState<Kind>('vehicle')
  const [vehicleId, setVehicleId] = useState<string | null>(null)
  const [driverId, setDriverId] = useState<string | null>(null)
  const [typeId, setTypeId] = useState('')
  const [permanent, setPermanent] = useState(false)
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<'upload' | 'issue' | null>(null)
  const [showErrors, setShowErrors] = useState(false)

  // The id belongs to one photo: once a photo is uploaded under it, a different (or no) photo needs a new id.
  const penaltyId = useRef(newPenaltyId())
  const uploaded = useRef(false)
  const onPhoto = (blob: Blob | null) => {
    if (uploaded.current) {
      penaltyId.current = newPenaltyId()
      uploaded.current = false
    }
    setPhoto(blob)
  }

  const tz = tenant.data?.timezone ?? DEFAULT_TIMEZONE
  const today = isoFromDateKey(dateKey(tz))
  const maxDate = new Date(Date.parse(`${today}T00:00:00Z`) + PENALTY_MAX_DAYS * 86_400_000).toISOString().slice(0, 10)

  const contractorNames = useMemo(() => new Map((contractors.data ?? []).map((c) => [c.id, c.name])), [contractors.data])
  const vehicleList = vehicles.data?.items
  const driverList = drivers.data?.items
  const vehicle = vehicleList?.find((v) => v.id === vehicleId)
  const driver = driverList?.find((d) => d.id === driverId)

  const wantsVehicle = kind !== 'driver'
  const wantsDriver = kind !== 'vehicle'
  // A penalty on both needs one contractor: choosing one side narrows the other.
  const lockContractor = kind === 'both' ? (vehicle?.contractorId ?? driver?.contractorId ?? null) : null

  const vehicleOptions: PickOption[] = useMemo(
    () =>
      (vehicleList ?? [])
        .filter((v) => !lockContractor || v.contractorId === lockContractor)
        .map((v) => ({
          id: v.id,
          label: v.plateNo,
          hint: [v.type, contractorNames.get(v.contractorId)].filter(Boolean).join(' · '),
          search: `${v.plateKey} ${v.makeModel ?? ''}`,
          flag: blocked.vehicles.has(v.id) ? t.alreadyBlocked : undefined,
        })),
    [vehicleList, lockContractor, contractorNames, blocked.vehicles],
  )
  const driverOptions: PickOption[] = useMemo(
    () =>
      (driverList ?? [])
        .filter((d) => !lockContractor || d.contractorId === lockContractor)
        .map((d) => ({
          id: d.id,
          label: d.name,
          hint: [contractorNames.get(d.contractorId), d.phone ? formatPhone(d.phone) : null].filter(Boolean).join(' · '),
          search: d.phone ?? '',
          flag: blocked.drivers.has(d.id) ? t.alreadyBlocked : undefined,
        })),
    [driverList, lockContractor, contractorNames, blocked.drivers],
  )

  const changeKind = (k: Kind) => {
    setKind(k)
    if (k === 'driver') setVehicleId(null)
    if (k === 'vehicle') setDriverId(null)
  }

  const targetOk = (wantsVehicle ? vehicleId !== null : true) && (wantsDriver ? driverId !== null : true)
  const typeOk = typeId !== '' && (types.data ?? []).some((x) => x.id === typeId)
  const dateOk = permanent || (endDate >= today && endDate <= maxDate)
  const reasonOk = reason.trim().length >= PENALTY_REASON_MIN
  const valid = targetOk && typeOk && dateOk && reasonOk

  const who = [wantsVehicle ? vehicle?.plateNo : null, wantsDriver ? driver?.name : null].filter(Boolean).join(' + ')

  const submit = async () => {
    setConfirming(false)
    try {
      if (photo && !uploaded.current) {
        setBusy('upload')
        await uploadPhoto(penaltyPhotoPath(claims.tenantId, penaltyId.current), photo)
        uploaded.current = true
      }
      setBusy('issue')
      await issuePenalty({
        penaltyId: penaltyId.current,
        ...(wantsVehicle && vehicleId ? { vehicleId } : {}),
        ...(wantsDriver && driverId ? { driverId } : {}),
        typeId,
        duration: permanent ? { kind: 'permanent' } : { kind: 'fixed', endDate },
        reason: reason.trim(),
        ...(photo ? { hasEvidence: true } : {}),
      })
      toast.success(t.issued)
      void navigate(listPath)
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const loading = types.isPending || vehicles.isPending || drivers.isPending || contractors.isPending || tenant.isPending
  const failed = types.isError || vehicles.isError || drivers.isError || contractors.isError
  const noTypes = !loading && !failed && (types.data?.length ?? 0) === 0

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link to={listPath} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          <ArrowLeft aria-hidden className="size-4" />
          {strings.penalties.issue.back}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-sm text-slate-600">{t.intro}</p>
      </div>

      {loading ? (
        <ListSkeleton />
      ) : failed ? (
        <ErrorState error={types.error ?? vehicles.error ?? drivers.error ?? contractors.error} onRetry={() => void Promise.all([types.refetch(), vehicles.refetch(), drivers.refetch(), contractors.refetch()])} />
      ) : (
        <form
          className="space-y-6 rounded-xl border border-slate-200 bg-surface p-4 sm:p-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            setShowErrors(true)
            if (valid) setConfirming(true)
          }}
        >
          <Segmented<Kind>
            legend={t.target}
            value={kind}
            disabled={busy !== null}
            onChange={changeKind}
            options={[
              { value: 'vehicle', label: t.targetKinds.vehicle },
              { value: 'driver', label: t.targetKinds.driver },
              { value: 'both', label: t.targetKinds.both },
            ]}
          />
          {kind === 'both' && <p className="-mt-3 text-xs text-slate-600">{t.sameContractor}</p>}
          {wantsVehicle && (
            <RecordPicker legend={t.vehicle} searchLabel={t.searchVehicle} options={vehicleOptions} value={vehicleId} onChange={setVehicleId} emptyText={t.noVehicles} noMatchText={t.noMatches} disabled={busy !== null} />
          )}
          {wantsDriver && (
            <RecordPicker legend={t.driver} searchLabel={t.searchDriver} options={driverOptions} value={driverId} onChange={setDriverId} emptyText={t.noDrivers} noMatchText={t.noMatches} disabled={busy !== null} />
          )}
          {showErrors && !targetOk && <p role="alert" className="-mt-3 text-xs text-danger">{t.targetError}</p>}

          {noTypes ? (
            <NotificationBanner tone="warning" title={t.noTypes}>
              {typesPath ? (
                <>
                  {t.noTypesAdmin} <Link to={typesPath} className="font-medium underline">{t.addTypes}</Link>
                </>
              ) : (
                t.noTypesSafety
              )}
            </NotificationBanner>
          ) : (
            <Select label={t.type} value={typeId} disabled={busy !== null} error={showErrors && !typeOk ? t.typeError : undefined} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">{t.typePlaceholder}</option>
              {(types.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}

          <div className="space-y-3">
            <Segmented<'fixed' | 'permanent'>
              legend={t.duration}
              value={permanent ? 'permanent' : 'fixed'}
              disabled={busy !== null}
              onChange={(v) => setPermanent(v === 'permanent')}
              options={[
                { value: 'fixed', label: t.fixed },
                { value: 'permanent', label: t.permanentOption },
              ]}
            />
            {!permanent && (
              <Input type="date" label={t.endDate} hint={t.endDateHint} value={endDate} min={today} max={maxDate} disabled={busy !== null} error={showErrors && !dateOk ? t.dateError : undefined} onChange={(e) => setEndDate(e.target.value)} />
            )}
          </div>

          <Textarea label={t.reason} hint={t.reasonHint} value={reason} maxLength={PENALTY_REASON_MAX} disabled={busy !== null} error={showErrors && !reasonOk ? t.reasonError : undefined} onChange={(e) => setReason(e.target.value)} />

          <PenaltyPhotoField value={photo} onChange={onPhoto} disabled={busy !== null} />

          <Button type="submit" className="w-full" loading={busy !== null} disabled={noTypes}>
            {busy === 'upload' ? t.uploading : t.submit}
          </Button>
        </form>
      )}

      <ConfirmDialog
        open={confirming}
        title={t.confirmTitle}
        body={t.confirmBody(who)}
        confirmLabel={t.confirm}
        tone="danger"
        loading={busy !== null}
        onConfirm={() => void submit()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
