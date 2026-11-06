import { zodResolver } from '@hookform/resolvers/zod'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { ArrowLeft, Eye, EyeOff, Lock } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageSpinner } from '@/components/ui/Spinner'
import { authErrorMessage } from '@/lib/errors'
import { auth } from '@/lib/firebase'
import { OPERATOR_HOME, ROLE_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { AuthHeading, AuthSplit } from './AuthSplit'
import { nextForRole, safeNext } from './redirect'
import { useAuth } from './useAuth'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const staffSchema = z.object({
  email: z.string().trim().email(strings.auth.invalidEmail),
  password: z.string().min(1, strings.auth.passwordRequired),
})
type StaffValues = z.infer<typeof staffSchema>

/**
 * `/login/staff`: email and password for office staff (admin, officer, supervisor) and the Super admin. Drivers and
 * security use the PIN screen at `/login` (Module 12); this form never mentions it.
 */
export default function StaffLoginPage() {
  const { status, session, operator, notice, clearNotice } = useAuth()
  const [params] = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  if (status === 'loading') return <PageSpinner />
  // Operators sign in on the same Staff tab and land on /platform (never on a workspace route).
  if (operator) {
    const next = safeNext(params.get('next'))
    return <Navigate to={next && (next === OPERATOR_HOME || next.startsWith(`${OPERATOR_HOME}/`)) ? next : OPERATOR_HOME} replace />
  }
  if (session) return <Navigate to={nextForRole(session.claims.role, params.get('next')) ?? ROLE_HOME[session.claims.role]} replace />

  const message = error ?? notice

  const signIn = async (email: string, password: string) => {
    clearNotice()
    setError(null)
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (e) {
      setError(authErrorMessage(e))
    }
  }

  return (
    <AuthSplit className="justify-center">
      <AuthHeading title={strings.auth.staffTitle} subtitle={strings.auth.staffIntro} />

      <div className="mt-8 space-y-4">
        {message && <NotificationBanner tone="error">{message}</NotificationBanner>}
        <StaffForm onSubmit={signIn} />
      </div>

      <div className="mt-auto pt-8 lg:mt-10">
        <div className="mb-4 flex items-center gap-3 text-sm text-slate-600" aria-hidden>
          <span className="h-px flex-1 bg-slate-200" />
          {strings.pinLogin.or}
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        <Link
          to={params.get('next') ? `/login?next=${encodeURIComponent(params.get('next') ?? '')}` : '/login'}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-surface px-4 text-base font-semibold text-ink transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {strings.auth.backToPin}
        </Link>
        <p className="mt-4 text-center lg:text-left">
          <Link
            to="/privacy"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm text-slate-600 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
          >
            <Lock aria-hidden className="size-3.5" />
            {strings.privacy.link}
          </Link>
        </p>
      </div>
    </AuthSplit>
  )
}

function StaffForm({ onSubmit }: { onSubmit: (email: string, password: string) => Promise<void> }) {
  const [show, setShow] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StaffValues>({ resolver: zodResolver(staffSchema) })

  return (
    <form onSubmit={handleSubmit((v) => onSubmit(v.email, v.password))} className="space-y-5" noValidate>
      <Input
        className="h-12 rounded-xl text-base"
        label={strings.auth.email}
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        error={errors.email?.message}
        {...register('email')}
      />
      <Input
        className="h-12 rounded-xl pr-12 text-base"
        label={strings.auth.password}
        type={show ? 'text' : 'password'}
        autoComplete="current-password"
        error={errors.password?.message}
        trailing={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? strings.auth.hidePassword : strings.auth.showPassword}
          >
            {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </Button>
        }
        {...register('password')}
      />
      <div className="-mt-2 flex justify-end">
        <Link
          to="/forgot-password"
          className="inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-semibold text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus"
        >
          {strings.auth.forgotPassword}
        </Link>
      </div>
      <Button type="submit" className="h-12 w-full rounded-xl text-base" loading={isSubmitting}>
        {isSubmitting ? strings.auth.signingIn : strings.auth.signIn}
      </Button>
    </form>
  )
}
