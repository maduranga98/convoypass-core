import { zodResolver } from '@hookform/resolvers/zod'
import { FirebaseError } from 'firebase/app'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageSpinner } from '@/components/ui/Spinner'
import { sendResetEmail } from '@/lib/emailActions'
import { ROLE_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { z } from '@/lib/zod'
import { AuthShell, Notice } from './AuthShell'
import { useAuth } from './useAuth'
import { useCooldown } from './useCooldown'

const t = strings.forgot
const COOLDOWN_SECONDS = 60
const schema = z.object({ email: z.string().trim().email(strings.auth.invalidEmail) })
type Values = z.infer<typeof schema>

/**
 * Staff password reset by email. The confirmation is the same whatever happened (unknown email, unsupported account,
 * server error), so the page can never be used to find out whether an account exists. Only a network failure says
 * so, because it says nothing about the account.
 */
export default function ForgotPasswordPage() {
  const { status, session } = useAuth()
  const [sent, setSent] = useState(false)
  const [offline, setOffline] = useState(false)
  const { remaining, start } = useCooldown(COOLDOWN_SECONDS)
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  if (status === 'loading') return <PageSpinner />
  if (session) return <Navigate to={ROLE_HOME[session.claims.role]} replace />

  const send = async (email: string) => {
    setOffline(false)
    try {
      await sendResetEmail(email.trim())
    } catch (e) {
      if (e instanceof FirebaseError && e.code === 'auth/network-request-failed') {
        setOffline(true)
        return
      }
      // Everything else looks like success from here.
    }
    setSent(true)
    start()
  }

  return (
    <AuthShell title={t.title} intro={sent ? undefined : t.intro}>
      <div className="space-y-4">
        {offline && <Notice>{strings.authErrors.network}</Notice>}
        {sent && (
          <div className="space-y-1">
            <Notice tone="info">{t.sent}</Notice>
            <p className="px-1 text-sm text-slate-600">{t.sentHint}</p>
          </div>
        )}
        <form onSubmit={handleSubmit((v) => send(v.email))} className="space-y-4" noValidate>
          <Input
            label={strings.auth.email}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            error={errors.email?.message}
            {...register('email')}
          />
          {sent ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={remaining > 0}
              loading={isSubmitting}
              onClick={() => void send(getValues('email'))}
            >
              {remaining > 0 ? t.resendIn(remaining) : t.resend}
            </Button>
          ) : (
            <Button type="submit" className="w-full" loading={isSubmitting}>
              {isSubmitting ? t.sending : t.send}
            </Button>
          )}
        </form>
        <Link to="/login/staff" className="inline-flex min-h-11 items-center text-sm font-medium text-slate-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus">
          {t.back}
        </Link>
      </div>
    </AuthShell>
  )
}
