import { zodResolver } from '@hookform/resolvers/zod'
import { Dices } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { resetCredential } from '@/lib/api'
import { generatePassword, isValidPassword } from '@/lib/credentials'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import type { Role } from '@/lib/roles'
import { CredentialsReveal } from './CredentialsReveal'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.admin.reset

/** Office staff passwords only: drivers and security have a PIN, which is reissued instead (Module 12). */
export interface ResetTarget {
  id: string
  role: Role
  name: string
  phone: string | null
  email: string | null
}

interface Revealed {
  secret: string
}

export function ResetCredentialModal({ user, onClose }: { user: ResetTarget | null; onClose: () => void }) {
  const [revealed, setRevealed] = useState<Revealed | null>(null)
  const close = () => {
    setRevealed(null)
    onClose()
  }
  const title = user ? t.resetPassword : t.title

  return (
    <Modal open={user !== null} onClose={close} title={revealed ? strings.admin.createUser.credentialsTitle : title}>
      {user &&
        (revealed ? (
          <CredentialsReveal loginId={user.email ?? ''} secret={revealed.secret} onDone={close} />
        ) : (
          <ResetForm user={user} onReset={(secret) => setRevealed({ secret })} onCancel={close} />
        ))}
    </Modal>
  )
}

function ResetForm({
  user,
  onReset,
  onCancel,
}: {
  user: ResetTarget
  onReset: (secret: string) => void
  onCancel: () => void
}) {
  const [formError, setFormError] = useState<string | null>(null)

  const schema = z.object({
    secret: z.string().refine(isValidPassword, strings.auth.passwordTooShort),
  })
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<{ secret: string }>({ resolver: zodResolver(schema), defaultValues: { secret: '' } })

  const submit = async ({ secret }: { secret: string }) => {
    setFormError(null)
    try {
      await resetCredential({ uid: user.id, newPassword: secret })
      toast.success(t.done)
      onReset(secret)
    } catch (e) {
      setFormError(apiErrorMessage(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600">{t.forUser(user.name)}</p>
      {formError && (
        <NotificationBanner tone="error">{formError}</NotificationBanner>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label={t.newPassword}
            type="text"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            error={errors.secret?.message}
            {...register('secret')}
          />
        </div>
        <Button
          variant="secondary"
          className="mb-px"
          icon={<Dices aria-hidden className="size-4" />}
          onClick={() => setValue('secret', generatePassword(), { shouldValidate: true })}
        >
          {strings.admin.createUser.generate}
        </Button>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          {strings.common.cancel}
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {t.submit}
        </Button>
      </div>
    </form>
  )
}
