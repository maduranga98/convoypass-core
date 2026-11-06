import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { updateUser } from '@/lib/api'
import { formatPhone, normalisePhone } from '@/lib/credentials'
import { apiErrorMessage } from '@/lib/errors'
import { isPinRole } from '@/lib/session'
import { strings } from '@/lib/strings'
import type { UserDoc, WithId } from '@/types'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.admin.editUser

interface Values {
  name: string
  phone: string
}

export function EditUserModal({ user, onClose }: { user: WithId<UserDoc> | null; onClose: () => void }) {
  return (
    <Modal open={user !== null} onClose={onClose} title={t.title}>
      {user && <EditUserForm user={user} onClose={onClose} />}
    </Modal>
  )
}

function EditUserForm({ user, onClose }: { user: WithId<UserDoc>; onClose: () => void }) {
  const queryClient = useQueryClient()
  // Drivers and security keep an optional contact number (Module 12); office staff have none.
  const hasPhone = isPinRole(user.role)
  const [formError, setFormError] = useState<string | null>(null)

  const schema = z
    .object({ name: z.string().trim().min(1, strings.admin.createUser.nameRequired).max(100), phone: z.string().trim() })
    .refine((v) => !hasPhone || v.phone === '' || normalisePhone(v.phone) !== null, { path: ['phone'], message: strings.auth.invalidPhone })

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: user.name, phone: user.phone ? formatPhone(user.phone) : '' },
  })

  const submit = async (v: Values) => {
    setFormError(null)
    const phone = hasPhone && v.phone.trim() !== '' ? normalisePhone(v.phone) : null
    const phoneChanged = hasPhone && phone !== (user.phone ?? null)
    try {
      await updateUser({
        uid: user.id,
        ...(v.name !== user.name ? { name: v.name } : {}),
        ...(phoneChanged ? { phone: phone === null ? null : v.phone } : {}), // as typed; the server normalises it
      })
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(t.updated)
      onClose()
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
      {hasPhone && (
        <Input label={t.phone} optional hint={strings.admin.createUser.phoneHint} type="tel" inputMode="tel" autoComplete="off" error={errors.phone?.message} {...register('phone')} />
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          {strings.common.cancel}
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {strings.common.save}
        </Button>
      </div>
    </form>
  )
}
