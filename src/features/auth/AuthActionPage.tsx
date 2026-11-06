import { zodResolver } from '@hookform/resolvers/zod'
import { FirebaseError } from 'firebase/app'
import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'
import { auth } from '@/lib/firebase'
import { checkStaffPassword, passwordAcceptable } from '@/lib/passwordRules'
import { strings } from '@/lib/strings'
import { z } from '@/lib/zod'
import { AuthShell, Notice } from './AuthShell'
import { PasswordChecklist } from './PasswordChecklist'
import { PasswordInput } from './PasswordInput'

const t = strings.authAction

const linkButton =
  'inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-medium text-on-solid hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
const textLink = 'inline-flex min-h-11 items-center text-sm font-medium text-slate-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus'

/** Firebase's email action page (`/auth/action?mode=...&oobCode=...`). The oobCode is held in memory and never shown. */
export default function AuthActionPage() {
  const [params] = useSearchParams()
  const mode = params.get('mode')
  const code = params.get('oobCode') ?? ''
  if (mode === 'resetPassword') return <ResetPassword code={code} />
  if (mode === 'verifyEmail') return <VerifyEmail code={code} />
  // Any other action (recoverEmail, email change, ...) is not handled here.
  return <Navigate to="/login/staff" replace />
}

type Outcome = 'checking' | 'ready' | 'expired' | 'invalid' | 'network'

const expiredOrInvalid = (e: unknown): 'expired' | 'invalid' | 'network' | 'other' => {
  const c = e instanceof FirebaseError ? e.code : ''
  if (c === 'auth/expired-action-code') return 'expired'
  if (c === 'auth/invalid-action-code' || c === 'auth/user-disabled' || c === 'auth/user-not-found') return 'invalid'
  if (c === 'auth/network-request-failed') return 'network'
  return 'other'
}

function ResetPassword({ code }: { code: string }) {
  const [outcome, setOutcome] = useState<Outcome>(code ? 'checking' : 'invalid')
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!code) return
    verifyPasswordResetCode(auth, code)
      .then((e) => {
        setEmail(e)
        setOutcome('ready')
      })
      .catch((e: unknown) => {
        const kind = expiredOrInvalid(e)
        setOutcome(kind === 'other' ? 'invalid' : kind)
      })
  }, [code])

  const schema = useMemo(
    () =>
      z
        .object({ password: z.string(), confirm: z.string() })
        .superRefine((v, ctx) => {
          if (!passwordAcceptable(checkStaffPassword(v.password, email))) ctx.addIssue({ code: 'custom', path: ['password'], message: strings.passwordRules.unacceptable })
          if (v.confirm !== v.password) ctx.addIssue({ code: 'custom', path: ['confirm'], message: strings.passwordRules.mismatch })
        }),
    [email],
  )
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<{ password: string; confirm: string }>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } })
  const password = useWatch({ control, name: 'password' }) ?? ''

  if (outcome === 'checking') return <PageSpinner />
  if (outcome === 'network') return <AuthShell title={t.resetTitle}><Notice>{t.network}</Notice></AuthShell>
  if (outcome === 'expired' || outcome === 'invalid') {
    return (
      <AuthShell title={t.resetTitle}>
        <div className="space-y-4">
          <Notice>{outcome === 'expired' ? t.linkExpired : t.linkInvalid}</Notice>
          <Link to="/forgot-password" className={linkButton}>{t.requestNew}</Link>
        </div>
      </AuthShell>
    )
  }
  if (done) {
    return (
      <AuthShell title={t.resetDoneTitle} intro={t.resetDone}>
        <Link to="/login/staff" className={linkButton}>{strings.auth.signIn}</Link>
      </AuthShell>
    )
  }

  const submit = async (v: { password: string }) => {
    setFormError(null)
    try {
      await confirmPasswordReset(auth, code, v.password)
      setDone(true)
    } catch (e) {
      const kind = expiredOrInvalid(e)
      if (kind === 'expired' || kind === 'invalid') setOutcome(kind)
      else if (kind === 'network') setFormError(t.network)
      else if (e instanceof FirebaseError && e.code === 'auth/weak-password') setFormError(strings.passwordRules.unacceptable)
      else setFormError(t.generic)
    }
  }

  return (
    <AuthShell title={t.resetTitle} intro={t.resetFor(email)}>
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {formError && <Notice>{formError}</Notice>}
        <div className="space-y-2">
          <PasswordInput label={strings.auth.newPassword} autoComplete="new-password" error={errors.password?.message} {...register('password')} />
          <PasswordChecklist checks={checkStaffPassword(password, email)} />
        </div>
        <PasswordInput label={strings.auth.confirmPassword} autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
        <Button type="submit" className="w-full" loading={isSubmitting}>
          {isSubmitting ? t.resetSaving : t.resetSubmit}
        </Button>
      </form>
    </AuthShell>
  )
}

function VerifyEmail({ code }: { code: string }) {
  const [outcome, setOutcome] = useState<'checking' | 'done' | 'expired' | 'invalid' | 'network'>(code ? 'checking' : 'invalid')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!code) return
    void (async () => {
      try {
        await applyActionCode(auth, code)
      } catch (e) {
        const kind = expiredOrInvalid(e)
        setOutcome(kind === 'other' ? 'invalid' : kind)
        return
      }
      // Signed in here too: pick up the new flag so the banner is gone when they go back.
      try {
        await auth.authStateReady() // a fresh page load restores the signed-in user asynchronously
        await auth.currentUser?.reload()
        await auth.currentUser?.getIdToken(true)
      } catch {
        /* the next sign-in picks it up */
      }
      setOutcome('done')
    })()
  }, [code])

  if (outcome === 'checking') return <PageSpinner />
  if (outcome === 'done') {
    return (
      <AuthShell title={t.verifyDoneTitle} intro={t.verifyDone}>
        <Link to="/" className={linkButton}>{auth.currentUser ? t.openApp : t.goToSignIn}</Link>
      </AuthShell>
    )
  }
  return (
    <AuthShell title={t.verifyTitle}>
      <div className="space-y-4">
        <Notice>{outcome === 'network' ? t.network : outcome === 'expired' ? t.linkExpired : t.linkInvalid}</Notice>
        {outcome !== 'network' && <p className="text-sm text-slate-600">{t.verifyNewHint}</p>}
        <Link to="/login/staff" className={textLink}>{t.goToSignIn}</Link>
      </div>
    </AuthShell>
  )
}
