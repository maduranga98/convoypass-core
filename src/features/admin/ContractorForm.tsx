import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { apiErrorMessage } from '@/lib/errors'
import { db } from '@/lib/firebase'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import type { Contractor, WithId } from '@/types'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.admin.contractors

const schema = z.object({
  name: z.string().trim().min(1, t.nameRequired).max(100),
  contactName: z.string().trim().max(100),
  phone: z.string().trim().max(30),
  address: z.string().trim().max(200),
  notes: z.string().trim().max(1000),
})
type Values = z.infer<typeof schema>

/** Descriptive fields only. `status` is changed exclusively through the setContractorStatus function. */
export function ContractorFormModal({ target, onClose }: { target: WithId<Contractor> | 'new' | null; onClose: () => void }) {
  return (
    <Modal open={target !== null} onClose={onClose} title={target === 'new' ? t.create : t.edit}>
      {target && <ContractorForm target={target} onClose={onClose} />}
    </Modal>
  )
}

function ContractorForm({ target, onClose }: { target: WithId<Contractor> | 'new'; onClose: () => void }) {
  const { uid, claims } = useSession()
  const queryClient = useQueryClient()
  const existing = target === 'new' ? null : target
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: existing?.name ?? '',
      contactName: existing?.contactName ?? '',
      phone: existing?.phone ?? '',
      address: existing?.address ?? '',
      notes: existing?.notes ?? '',
    },
  })

  const submit = async (v: Values) => {
    setFormError(null)
    try {
      if (existing) {
        await updateDoc(doc(db, 'contractors', existing.id), {
          name: v.name,
          contactName: v.contactName || null,
          phone: v.phone || null,
          address: v.address || null,
          notes: v.notes || null,
          updatedAt: serverTimestamp(),
        })
      } else {
        await addDoc(collection(db, 'contractors'), {
          tenantId: claims.tenantId,
          name: v.name,
          ...(v.contactName ? { contactName: v.contactName } : {}),
          ...(v.phone ? { phone: v.phone } : {}),
          ...(v.address ? { address: v.address } : {}),
          ...(v.notes ? { notes: v.notes } : {}),
          status: 'active', // a new contractor always starts active; rules reject anything else
          createdAt: serverTimestamp(),
          createdBy: uid,
          updatedAt: serverTimestamp(),
        })
      }
      await queryClient.invalidateQueries({ queryKey: ['contractors'] })
      toast.success(existing ? t.updated : t.created)
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
      <Input label={t.contactName} optional autoComplete="off" error={errors.contactName?.message} {...register('contactName')} />
      <Input label={t.phone} optional type="tel" inputMode="tel" autoComplete="off" error={errors.phone?.message} {...register('phone')} />
      <Input label={t.address} optional autoComplete="off" error={errors.address?.message} {...register('address')} />
      <Textarea label={t.notes} optional error={errors.notes?.message} {...register('notes')} />
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
