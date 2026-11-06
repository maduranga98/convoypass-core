import { zodResolver } from '@hookform/resolvers/zod'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { changeOwnPassword } from '@/lib/api'
import { isValidPassword } from '@/lib/credentials'
import { apiErrorMessage, apiErrorReason } from '@/lib/errors'
import { auth } from '@/lib/firebase'
import { ROLE_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { nextForRole } from './redirect'
import { useAuth, useSession } from './useAuth'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

interface Values {
  newPassword: string
  confirm: string
}

export default function ChangePasswordPage() {
  const session = useSession()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)

  const t = strings.auth

  const schema = useMemo(
    () =>
      z
        .object({ newPassword: z.string(), confirm: z.string() })
        .superRefine((v, ctx) => {
          if (!isValidPassword(v.newPassword)) ctx.addIssue({ code: 'custom', path: ['newPassword'], message: t.passwordTooShort })
          if (v.confirm !== v.newPassword) ctx.addIssue({ code: 'custom', path: ['confirm'], message: t.passwordMismatch })
        }),
    [t],
  )

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  const submit = async ({ newPassword }: Values) => {
    setError(null)
    try {
      await changeOwnPassword({ newPassword })
    } catch (e) {
      setNeedsSignIn(apiErrorReason(e) === 'recent-login-required')
      setError(apiErrorMessage(e))
      return
    }
    // Changing the password can invalidate the old session: sign in again with the new credential,
    // then force-refresh the token so claims are current.
    const email = auth.currentUser?.email
    try {
      if (email) await signInWithEmailAndPassword(auth, email, newPassword)
      await auth.currentUser?.getIdToken(true)
    } catch {
      await signOut()
      return
    }
    toast.success(t.passwordUpdated)
    navigate(nextForRole(session.claims.role, params.get('next')) ?? ROLE_HOME[session.claims.role], { replace: true })
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <h1 className="text-xl font-semibold">{t.changePasswordTitle}</h1>
          <p className="mt-1 mb-6 text-sm text-slate-500">{t.changePasswordIntro}</p>

          {error && (
            <NotificationBanner tone="error" className="mb-4">{error}</NotificationBanner>
          )}

          <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
            <Input
              label={t.newPassword}
              type="password"
              autoComplete="new-password"
              error={errors.newPassword?.message}
              {...register('newPassword')}
            />
            <Input
              label={t.confirmPassword}
              type="password"
              autoComplete="new-password"
              error={errors.confirm?.message}
              {...register('confirm')}
            />
            <Button type="submit" className="w-full" loading={isSubmitting}>
              {t.updatePassword}
            </Button>
          </form>

          <Button variant="ghost" className="mt-3 w-full" onClick={() => void signOut()}>
            {needsSignIn ? t.signIn : strings.common.signOut}
          </Button>
        </div>
      </div>
    </main>
  )
}
