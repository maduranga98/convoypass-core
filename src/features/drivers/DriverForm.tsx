import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { createUser, updateUser } from '@/lib/api'
import { formatPhone, normalisePhone } from '@/lib/credentials'
import { apiErrorMessage } from '@/lib/errors'
import { isExpiryDate } from '@/lib/expiry'
import { driverPhotoPath } from '@/lib/photoPath'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { useContractorList, useDriverPhotoUrl } from '@/features/shared/queries'
import { useScope, type Scope } from '@/features/shared/scope'
import type { Driver, WithId } from '@/types'
import { PinCard } from '@/features/admin/PinCard'
import { useIssuedPin, type IssuedPin } from '@/features/admin/pinCardState'
import { uploadDriverPhoto } from './photo'
import { PhotoField } from './PhotoField'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.drivers.form

interface Props {
  scope: Scope
  /** `null` closed, `'new'` create, otherwise edit. */
  target: WithId<Driver> | 'new' | null
  onClose: () => void
}

/** Create or edit a driver. A new driver gets a server-generated PIN, shown once on the PIN card (Module 12). */
export function DriverFormModal({ scope, target, onClose }: Props) {
  const [created, setCreated] = useIssuedPin()
  const close = () => {
    setCreated(null)
    onClose()
  }
  return (
    <Modal
      open={target !== null}
      onClose={close}
      dismissible={created === null}
      title={created ? strings.pinCard.title : target === 'new' ? strings.drivers.add : strings.drivers.edit}
      variant="drawer"
    >
      {target &&
        (created ? (
          <PinCard issued={created} onDone={close} />
        ) : (
          <DriverForm scope={scope} target={target} onClose={close} onCreated={setCreated} />
        ))}
    </Modal>
  )
}

const schema = z
  .object({
    name: z.string().trim().min(1, t.nameRequired).max(100),
    phone: z.string().trim(),
    contractorId: z.string(),
    licenseNo: z.string().trim().max(30),
    licenseExpiry: z.string(),
  })
type Values = z.infer<typeof schema>

function DriverForm({ scope, target, onClose, onCreated }: Omit<Props, 'target'> & { target: WithId<Driver> | 'new'; onCreated: (c: IssuedPin) => void }) {
  const queryClient = useQueryClient()
  const { claims } = useSession()
  const { isAdmin, contractorId: ownContractorId } = useScope(scope)
  const contractors = useContractorList(scope)
  const existing = target === 'new' ? null : target
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const { data: currentUrl } = useDriverPhotoUrl(existing?.photoPath, existing?.updatedAt?.seconds)
  const activeContractors = (contractors.data ?? []).filter((c) => c.status === 'active')

  const resolver = useMemo(
    () =>
      zodResolver(
        schema.superRefine((v, ctx) => {
          const issue = (path: keyof Values, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
          // Contact number only: optional, not unique, never a login.
          if (v.phone !== '' && !normalisePhone(v.phone)) issue('phone', strings.auth.invalidPhone)
          if (v.licenseExpiry === '') issue('licenseExpiry', strings.eligibility.required)
          else if (!isExpiryDate(v.licenseExpiry)) issue('licenseExpiry', strings.eligibility.invalid)
          if (existing) return
          if (isAdmin && !v.contractorId) issue('contractorId', t.contractorRequired)
        }),
      ),
    [existing, isAdmin],
  )

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver,
    defaultValues: {
      name: existing?.name ?? '',
      phone: existing ? formatPhone(existing.phone) : '',
      contractorId: '',
      licenseNo: existing?.licenseNo ?? '',
      licenseExpiry: existing?.licenseExpiry ?? '',
    },
  })

  const watchedName = useWatch({ control, name: 'name' })

  const uploadAndAttach = async (uid: string, contractorId: string): Promise<boolean> => {
    if (!photo) return true
    try {
      const path = driverPhotoPath(claims.tenantId, contractorId, uid)
      await uploadDriverPhoto(path, photo)
      await updateUser({ uid, photoPath: path })
      return true
    } catch {
      toast.warning(t.photoUploadFailed)
      return false
    }
  }

  const submit = async (v: Values) => {
    setFormError(null)
    const licenseNo = v.licenseNo.trim()
    try {
      if (existing) {
        const photoOk = await uploadAndAttach(existing.id, existing.contractorId)
        const name = v.name.trim()
        const phone = v.phone.trim() === '' ? null : normalisePhone(v.phone)
        const phoneChanged = phone !== (existing.phone ?? null)
        const expiryChanged = v.licenseExpiry !== (existing.licenseExpiry ?? '')
        if (name !== existing.name || licenseNo !== (existing.licenseNo ?? '') || phoneChanged || expiryChanged) {
          await updateUser({
            uid: existing.id,
            ...(name !== existing.name ? { name } : {}),
            ...(licenseNo !== (existing.licenseNo ?? '') ? { licenseNo: licenseNo || null } : {}),
            ...(expiryChanged ? { licenseExpiry: v.licenseExpiry } : {}),
            ...(phoneChanged ? { phone: phone === null ? null : v.phone } : {}), // as typed: the server normalises it
          })
        }
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['drivers'] }), queryClient.invalidateQueries({ queryKey: ['driverPhotoUrl'] })])
        if (photoOk) toast.success(t.updated)
        onClose()
        return
      }

      const contractorId = isAdmin ? v.contractorId : (ownContractorId ?? '')
      const { uid, pin } = await createUser({
        role: 'driver',
        name: v.name.trim(),
        // Contact number as typed (the server normalises it); optional. No password: the server makes the PIN.
        ...(v.phone.trim() ? { phone: v.phone } : {}),
        contractorId,
        ...(licenseNo ? { licenseNo } : {}),
        licenseExpiry: v.licenseExpiry,
      })
      await uploadAndAttach(uid, contractorId)
      await queryClient.invalidateQueries({ queryKey: ['drivers'] })
      toast.success(t.created)
      if (pin) {
        const company = (contractors.data ?? []).find((c) => c.id === contractorId)?.name ?? ''
        onCreated({ pin, name: v.name.trim(), role: 'driver', company })
      }
    } catch (e) {
      setFormError(apiErrorMessage(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      {formError && (
        <NotificationBanner tone="error">{formError}</NotificationBanner>
      )}

      <Input label={t.name} autoComplete="off" error={errors.name?.message} {...register('name')} />

      <Input
        label={t.phone}
        optional
        type="tel"
        inputMode="tel"
        autoComplete="off"
        placeholder={strings.auth.phoneHint}
        hint={t.phoneHint}
        error={errors.phone?.message}
        {...register('phone', {
          onBlur: () => {
            const n = normalisePhone(getValues('phone'))
            if (n) setValue('phone', formatPhone(n))
          },
        })}
      />

      {isAdmin && !existing && (
        <Select label={t.contractor} error={errors.contractorId?.message} disabled={contractors.isPending} {...register('contractorId')}>
          <option value="">{t.contractorPlaceholder}</option>
          {activeContractors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t.licenseNo} optional autoComplete="off" error={errors.licenseNo?.message} {...register('licenseNo')} />
        <Input label={t.licenseExpiry} type="date" error={errors.licenseExpiry?.message} {...register('licenseExpiry')} />
      </div>

      <PhotoField name={watchedName} currentUrl={currentUrl ?? null} value={photo} onChange={setPhoto} disabled={isSubmitting} />

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
