import { zodResolver } from '@hookform/resolvers/zod'
import { FirebaseError } from 'firebase/app'
import { EmailAuthProvider, reauthenticateWithCredential, signInWithEmailAndPassword } from 'firebase/auth'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/features/auth/AuthShell'
import { PasswordChecklist } from '@/features/auth/PasswordChecklist'
import { PasswordInput } from '@/features/auth/PasswordInput'
import { useSession } from '@/features/auth/useAuth'
import { changeOwnPassword } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { auth } from '@/lib/firebase'
import { checkStaffPassword, passwordAcceptable } from '@/lib/passwordRules'
import { strings } from '@/lib/strings'
import { z } from '@/lib/zod'

const t = strings.account
interface Values {
  current: string
  next: string
  confirm: string
}

/**
 * Voluntary password change (office staff; PIN users have none, Module 12). The current secret is checked first (reauthenticateWithCredential, then a fresh
 * ID token, so the server's 5-minute `auth_time` rule is satisfied); only then does `changeOwnPassword` run. The
 * device stays signed in: the new credential is used to refresh the session straight away.
 */
export function ChangeCredentialCard() {
  const { profile } = useSession()
  const email = auth.currentUser?.email ?? profile.email ?? ''
  const [formError, setFormError] = useState<string | null>(null)

  const schema = useMemo(
    () =>
      z
        .object({ current: z.string().min(1, t.currentRequired), next: z.string(), confirm: z.string() })
        .superRefine((v, ctx) => {
          if (!passwordAcceptable(checkStaffPassword(v.next, email))) {
            ctx.addIssue({ code: 'custom', path: ['next'], message: strings.passwordRules.unacceptable })
          }
          if (v.next !== '' && v.next === v.current) ctx.addIssue({ code: 'custom', path: ['next'], message: t.sameAsCurrent })
          if (v.confirm !== v.next) ctx.addIssue({ code: 'custom', path: ['confirm'], message: strings.passwordRules.mismatch })
        }),
    [email],
  )
  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { current: '', next: '', confirm: '' } })
  const next = useWatch({ control, name: 'next' }) ?? ''

  const submit = async (v: Values) => {
    setFormError(null)
    const user = auth.currentUser
    if (!user || !email) return setFormError(t.failed)

    // 1. Prove the current secret and get a token with a fresh auth_time.
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, v.current))
      await user.getIdToken(true)
    } catch (e) {
      const code = e instanceof FirebaseError ? e.code : ''
      if (code === 'auth/too-many-requests') return setFormError(t.tooMany)
      if (code === 'auth/network-request-failed') return setFormError(strings.authErrors.network)
      return setError('current', { message: t.currentWrong })
    }

    // 2. The change itself, on the server.
    try {
      await changeOwnPassword({ newPassword: v.next })
    } catch (e) {
      return setFormError(apiErrorMessage(e))
    }

    // 3. Stay signed in on this device: a password change can invalidate the old refresh token.
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, v.next))
      await user.getIdToken(true)
    } catch {
      try {
        await signInWithEmailAndPassword(auth, email, v.next)
      } catch {
        /* the next sign-in uses the new credential */
      }
    }
    reset()
    toast.success(t.updated)
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate aria-labelledby="change-credential-h">
      <h3 id="change-credential-h" className="font-semibold">{t.changePassword}</h3>
      {formError && <Notice>{formError}</Notice>}
      <PasswordInput label={t.current} autoComplete="current-password" error={errors.current?.message} {...register('current')} />
      <div className="space-y-2">
        <PasswordInput label={t.new} autoComplete="new-password" error={errors.next?.message} {...register('next')} />
        <PasswordChecklist checks={checkStaffPassword(next, email)} />
      </div>
      <PasswordInput label={t.confirm} autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
      <Button type="submit" loading={isSubmitting}>
        {isSubmitting ? t.saving : t.submit}
      </Button>
    </form>
  )
}
