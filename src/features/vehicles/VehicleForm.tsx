import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { createVehicle, setVehicleDrivers, updateVehicle } from '@/lib/api'
import { apiErrorMessage, apiErrorReason } from '@/lib/errors'
import { formatPlateInput, normalisePlate } from '@/lib/plate'
import { strings } from '@/lib/strings'
import { isExpiryDate } from '@/lib/expiry'
import { useTenantDocuments } from '@/features/shared/documents'
import { useContractorList, useDrivers } from '@/features/shared/queries'
import { useScope, type Scope } from '@/features/shared/scope'
import type { Vehicle, WithId } from '@/types'
import { assignableDrivers } from './assignable'
import { useBlocked } from '@/features/penalties/feed'
import { DriverPicker } from './DriverPicker'
import { useDriverAssignments } from './useDriverAssignments'
import { vehicleFieldsSchemaFor } from './schemas'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.vehicles.form

const expiry = z.string().refine((v) => v === '' || isExpiryDate(v), strings.eligibility.invalid)
const schemaFor = (types: readonly string[]) =>
  vehicleFieldsSchemaFor(types).extend({
    contractorId: z.string(),
    driverIds: z.array(z.string()),
    insuranceExpiry: expiry,
    registrationExpiry: expiry,
    annualInspectionExpiry: expiry,
  })
type Values = z.infer<ReturnType<typeof schemaFor>>

interface Props {
  scope: Scope
  /** `null` closed, `'new'` create, otherwise edit. */
  target: WithId<Vehicle> | 'new' | null
  onClose: () => void
  onCreated?: (vehicleId: string) => void
}

export function VehicleFormModal({ scope, target, onClose, onCreated }: Props) {
  return (
    <Modal open={target !== null} onClose={onClose} title={target === 'new' ? strings.vehicles.add : strings.vehicles.edit} variant="drawer">
      {target && <VehicleForm scope={scope} target={target} onClose={onClose} {...(onCreated ? { onCreated } : {})} />}
    </Modal>
  )
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

function VehicleForm({ scope, target, onClose, onCreated }: Omit<Props, 'target'> & { target: WithId<Vehicle> | 'new' }) {
  const queryClient = useQueryClient()
  const { isAdmin, contractorId: ownContractorId } = useScope(scope)
  const contractors = useContractorList(scope)
  const drivers = useDrivers(scope)
  const blocked = useBlocked(scope)
  const takenBy = useDriverAssignments(scope, target === 'new' ? undefined : target.id)
  const blockedDrivers = useMemo(() => new Set(blocked.drivers.keys()), [blocked.drivers])
  const { vehicleTypes } = useTenantDocuments()
  const existing = target === 'new' ? null : target
  const [formError, setFormError] = useState<string | null>(null)

  const activeContractors = (contractors.data ?? []).filter((c) => c.status === 'active')
  // A vehicle keeps its type even if the list changed since; it stays selectable while editing it.
  const typeOptions = existing && !vehicleTypes.includes(existing.type) ? [...vehicleTypes, existing.type] : vehicleTypes
  const allDrivers = useMemo(() => drivers.data?.items ?? [], [drivers.data])

  const initialDrivers = useMemo(() => {
    if (!existing) return []
    const active = new Set(assignableDrivers(allDrivers, existing.contractorId).map((d) => d.id))
    return existing.assignedDriverIds.filter((id) => active.has(id))
  }, [existing, allDrivers])

  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(
      schemaFor(typeOptions).superRefine((v, ctx) => {
        if (isAdmin && !existing && !v.contractorId) ctx.addIssue({ code: 'custom', path: ['contractorId'], message: strings.vehicles.errors.contractor })
        // The annual inspection date is not asked of supervisors.
        const required = isAdmin
          ? (['insuranceExpiry', 'registrationExpiry', 'annualInspectionExpiry'] as const)
          : (['insuranceExpiry', 'registrationExpiry'] as const)
        for (const path of required) {
          if (v[path] === '') ctx.addIssue({ code: 'custom', path: [path], message: strings.eligibility.required })
        }
      }),
    ),
    defaultValues: {
      plateNo: existing?.plateNo ?? '',
      type: (existing?.type ?? '') as Values['type'],
      makeModel: existing?.makeModel ?? '',
      insuranceExpiry: existing?.insuranceExpiry ?? '',
      registrationExpiry: existing?.registrationExpiry ?? '',
      annualInspectionExpiry: existing?.annualInspectionExpiry ?? '',
      contractorId: existing?.contractorId ?? '',
      driverIds: initialDrivers,
    },
  })

  const plate = useWatch({ control, name: 'plateNo' })
  const contractorValue = useWatch({ control, name: 'contractorId' })
  const effectiveContractor = existing?.contractorId ?? (isAdmin ? contractorValue : (ownContractorId ?? ''))
  const normalised = normalisePlate(plate)

  const submit = async (v: Values) => {
    setFormError(null)
    const makeModel = v.makeModel.trim()
    try {
      if (existing) {
        const changes = {
          ...(v.plateNo !== existing.plateNo ? { plateNo: v.plateNo } : {}),
          ...(v.type !== existing.type ? { type: v.type } : {}),
          ...(makeModel !== (existing.makeModel ?? '') ? { makeModel } : {}),
          ...(v.insuranceExpiry !== (existing.insuranceExpiry ?? '') ? { insuranceExpiry: v.insuranceExpiry } : {}),
          ...(v.registrationExpiry !== (existing.registrationExpiry ?? '') ? { registrationExpiry: v.registrationExpiry } : {}),
          ...(isAdmin && v.annualInspectionExpiry !== (existing.annualInspectionExpiry ?? '') ? { annualInspectionExpiry: v.annualInspectionExpiry } : {}),
        }
        if (Object.keys(changes).length > 0) await updateVehicle({ vehicleId: existing.id, ...changes })
        if (!sameSet(v.driverIds, initialDrivers)) await setVehicleDrivers({ vehicleId: existing.id, driverIds: v.driverIds })
        toast.success(t.updated)
      } else {
        const { vehicleId } = await createVehicle({
          ...(isAdmin ? { contractorId: v.contractorId } : {}),
          plateNo: v.plateNo,
          type: v.type,
          ...(makeModel ? { makeModel } : {}),
          insuranceExpiry: v.insuranceExpiry,
          registrationExpiry: v.registrationExpiry,
          ...(isAdmin && v.annualInspectionExpiry ? { annualInspectionExpiry: v.annualInspectionExpiry } : {}),
          ...(v.driverIds.length > 0 ? { driverIds: v.driverIds } : {}),
        })
        toast.success(t.created)
        onCreated?.(vehicleId)
      }
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      onClose()
    } catch (e) {
      if (apiErrorReason(e) === 'plate-exists') setError('plateNo', { message: strings.apiErrors['plate-exists'] })
      else setFormError(apiErrorMessage(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      {formError && (
        <NotificationBanner tone="error">{formError}</NotificationBanner>
      )}

      <Controller
        control={control}
        name="plateNo"
        render={({ field }) => (
          <Input
            label={t.plate}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono text-lg font-semibold uppercase tracking-wide"
            hint={normalised && normalised.plateNo !== plate ? `${strings.vehicles.form.saveAs} ${normalised.plateNo}` : t.plateHint}
            error={errors.plateNo?.message}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            value={field.value}
            onChange={(e) => field.onChange(formatPlateInput(e.target.value))}
          />
        )}
      />

      <Select label={t.type} error={errors.type?.message} {...register('type')}>
        <option value="">{t.typePlaceholder}</option>
        {typeOptions.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </Select>

      <Input label={t.makeModel} optional autoComplete="off" error={errors.makeModel?.message} {...register('makeModel')} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t.insuranceExpiry} type="date" error={errors.insuranceExpiry?.message} {...register('insuranceExpiry')} />
        <Input label={t.registrationExpiry} type="date" error={errors.registrationExpiry?.message} {...register('registrationExpiry')} />
        {isAdmin && (
          <Input label={t.annualInspectionExpiry} type="date" hint={strings.eligibility.annualInspectionHint} error={errors.annualInspectionExpiry?.message} {...register('annualInspectionExpiry')} />
        )}
      </div>

      {isAdmin &&
        (existing ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-700">{t.contractor}</p>
            <p className="text-sm text-slate-600">{contractors.data?.find((c) => c.id === existing.contractorId)?.name ?? strings.common.none}</p>
          </div>
        ) : (
          <Select
            label={t.contractor}
            error={errors.contractorId?.message}
            disabled={contractors.isPending}
            {...register('contractorId', { onChange: () => setValue('driverIds', []) })}
          >
            <option value="">{t.contractorPlaceholder}</option>
            {activeContractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        ))}

      <Controller
        control={control}
        name="driverIds"
        render={({ field }) => (
          <DriverPicker drivers={allDrivers} contractorId={effectiveContractor} value={field.value} onChange={field.onChange} disabled={drivers.isPending} blockedIds={blockedDrivers} takenBy={takenBy} />
        )}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          {strings.common.cancel}
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {existing ? strings.common.save : t.submit}
        </Button>
      </div>
    </form>
  )
}
