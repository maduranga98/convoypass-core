import { zodResolver } from '@hookform/resolvers/zod'
import { FirebaseError } from 'firebase/app'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useWatch, type UseFormRegisterReturn } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageSpinner } from '@/components/ui/Spinner'
import { AuthShell, Notice } from '@/features/auth/AuthShell'
import { PasswordChecklist } from '@/features/auth/PasswordChecklist'
import { PasswordInput } from '@/features/auth/PasswordInput'
import { useAuth } from '@/features/auth/useAuth'
import { completeSetup, validateSetupInvite } from '@/lib/api'
import { sendVerificationEmail } from '@/lib/emailActions'
import { apiErrorReason } from '@/lib/errors'
import { auth } from '@/lib/firebase'
import { checkStaffPassword, passwordAcceptable } from '@/lib/passwordRules'
import { strings } from '@/lib/strings'
import { DEFAULT_SETUP_TIMEZONE, timezoneList } from '@/lib/timezones'
import { z } from '@/lib/zod'
import { takeCodeFromLocation } from './inviteCode'

const t = strings.setup

type Phase = { kind: 'validating' } | { kind: 'invalid' } | { kind: 'form'; companyHint?: string; emailLock?: string }

/** Keeps the page out of search results and stops it leaking its URL; removed again on leaving. */
function usePrivateMeta(): void {
  useEffect(() => {
    const added = [
      ['robots', 'noindex, nofollow'],
      ['referrer', 'no-referrer'],
    ].map(([name, content]) => {
      const m = document.createElement('meta')
      m.name = name as string
      m.content = content as string
      document.head.appendChild(m)
      return m
    })
    return () => added.forEach((m) => m.remove())
  }, [])
}

interface Values {
  companyName: string
  adminName: string
  email: string
  password: string
  confirm: string
  timezone: string
}

export default function SetupPage() {
  usePrivateMeta()
  const { status, session, signOut } = useAuth()
  const [phase, setPhase] = useState<Phase>({ kind: 'validating' })
  // The code lives in memory only. The ref survives React's dev double-run of effects, which would otherwise find the fragment gone.
  const codeRef = useRef<string | null>(null)
  const started = useRef(false)
  const [finishing, setFinishing] = useState(false)

  const latest = useRef(0)

  useEffect(() => {
    const validate = (code: string) => {
      const mine = ++latest.current
      setPhase({ kind: 'validating' })
      validateSetupInvite({ code })
        .then((r) => ({ kind: r.valid ? 'form' : 'invalid', ...(r.companyHint ? { companyHint: r.companyHint } : {}), ...(r.emailLock ? { emailLock: r.emailLock } : {}) }) as Phase)
        // An unreachable server is not proof the link is bad, but the page cannot continue either way.
        .catch((): Phase => ({ kind: 'invalid' }))
        .then((next) => {
          if (mine === latest.current) setPhase(next) // an older check never overwrites a newer link
        })
    }
    const found = takeCodeFromLocation()
    if (found) codeRef.current = found
    if (!started.current) {
      started.current = true
      if (codeRef.current) validate(codeRef.current)
      else setPhase({ kind: 'invalid' })
    }
    // A new link pasted into the address bar of an open /setup tab only changes the fragment: no reload happens.
    const onHashChange = () => {
      const next = takeCodeFromLocation()
      if (!next) return
      codeRef.current = next
      validate(next)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  if (status === 'loading' || phase.kind === 'validating') return <PageSpinner />

  if (session && !finishing) {
    return (
      <AuthShell title={t.title}>
        <div className="space-y-4">
          <Notice tone="info">{t.signedIn(session.profile.name || session.profile.email || '')}</Notice>
          <Button className="w-full" onClick={() => void signOut()}>
            {t.signOut}
          </Button>
        </div>
      </AuthShell>
    )
  }

  if (phase.kind === 'invalid') {
    return (
      <AuthShell title={t.invalidTitle}>
        <p className="text-sm text-slate-600">{t.invalidHelp}</p>
      </AuthShell>
    )
  }

  return (
    <SetupForm
      getCode={() => codeRef.current}
      spendCode={() => {
        codeRef.current = null
      }}
      {...(phase.companyHint ? { companyHint: phase.companyHint } : {})}
      {...(phase.emailLock ? { emailLock: phase.emailLock } : {})}
      onInvalid={() => setPhase({ kind: 'invalid' })}
      onFinishing={setFinishing}
    />
  )
}

function SetupForm({
  getCode,
  spendCode,
  companyHint,
  emailLock,
  onInvalid,
  onFinishing,
}: {
  getCode: () => string | null
  spendCode: () => void
  companyHint?: string
  emailLock?: string
  onInvalid: () => void
  onFinishing: (on: boolean) => void
}) {
  const navigate = useNavigate()
  const zones = useMemo(() => timezoneList(), [])
  const [formError, setFormError] = useState<string | null>(null)
  const submitting = useRef(false)

  const schema = useMemo(
    () =>
      z
        .object({
          companyName: z.string().trim().min(2, t.companyRequired).max(80, t.companyRequired),
          adminName: z.string().trim().min(2, t.nameRequired).max(60, t.nameRequired),
          email: z.string().trim().email(t.emailInvalid),
          password: z.string(),
          confirm: z.string(),
          timezone: z.string().refine((v) => zones.includes(v), t.timezoneInvalid),
        })
        .superRefine((v, ctx) => {
          if (!passwordAcceptable(checkStaffPassword(v.password, v.email))) ctx.addIssue({ code: 'custom', path: ['password'], message: strings.passwordRules.unacceptable })
          if (v.confirm !== v.password) ctx.addIssue({ code: 'custom', path: ['confirm'], message: strings.passwordRules.mismatch })
        }),
    [zones],
  )

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { companyName: companyHint ?? '', adminName: '', email: emailLock ?? '', password: '', confirm: '', timezone: DEFAULT_SETUP_TIMEZONE },
  })
  const password = useWatch({ control, name: 'password' }) ?? ''
  const email = useWatch({ control, name: 'email' }) ?? ''
  const checks = checkStaffPassword(password, email)

  const submit = async (v: Values) => {
    const code = getCode()
    if (submitting.current || !code) return // double-submit protection
    submitting.current = true
    setFormError(null)
    const emailNorm = v.email.trim().toLowerCase()
    try {
      onFinishing(true) // the sign-in below must not flash the "already signed in" notice
      await completeSetup({
        code,
        companyName: v.companyName.trim(),
        adminName: v.adminName.trim(),
        email: emailNorm,
        password: v.password,
        timezone: v.timezone,
      })
    } catch (e) {
      submitting.current = false
      onFinishing(false)
      const reason = apiErrorReason(e)
      if (reason === 'setup-invalid') return onInvalid()
      if (reason === 'email-exists') return setError('email', { message: t.emailExists })
      if (reason === 'weak-password' || reason === 'common-password' || reason === 'password-is-email') return setError('password', { message: strings.apiErrors[reason] })
      if (reason === 'timezone-invalid') return setError('timezone', { message: t.timezoneInvalid })
      if (e instanceof FirebaseError && e.code === 'functions/resource-exhausted') return setFormError(t.rateLimited)
      if (e instanceof FirebaseError && (e.code === 'functions/unavailable' || e.code === 'functions/deadline-exceeded')) return setFormError(t.network)
      return setFormError(t.generic)
    }

    spendCode() // spent
    try {
      const cred = await signInWithEmailAndPassword(auth, emailNorm, v.password)
      await cred.user.getIdToken(true)
      void sendVerificationEmail(cred.user).catch(() => undefined) // best effort
    } catch {
      navigate('/login/staff', { replace: true })
      return
    }
    navigate('/admin/dashboard?welcome=1', { replace: true })
  }
  return (
    <AuthShell title={t.title} intro={companyHint ? t.forCompany(companyHint) : t.intro}>
      <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4" noValidate>
        {formError && <Notice>{formError}</Notice>}
        <Input label={t.companyName} autoComplete="organization" error={errors.companyName?.message} {...register('companyName')} />
        <Input label={t.adminName} autoComplete="name" error={errors.adminName?.message} {...register('adminName')} />
        <Input
          label={t.email}
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          readOnly={Boolean(emailLock)}
          hint={emailLock ? t.emailLocked : undefined}
          error={errors.email?.message}
          {...register('email')}
        />
        <div className="space-y-2">
          <PasswordInput label={t.password} autoComplete="new-password" error={errors.password?.message} {...register('password')} />
          <PasswordChecklist checks={checks} />
        </div>
        <PasswordInput label={t.confirm} autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
        <TimezoneField zones={zones} error={errors.timezone?.message} registerProps={register('timezone')} />
        <Button type="submit" className="w-full" loading={isSubmitting}>
          {isSubmitting ? t.submitting : t.submit}
        </Button>
      </form>
    </AuthShell>
  )
}

function TimezoneField({ zones, error, registerProps }: { zones: string[]; error: string | undefined; registerProps: UseFormRegisterReturn }) {
  const listId = 'setup-timezones'
  return (
    <>
      <Input label={t.timezone} list={listId} autoComplete="off" autoCapitalize="none" spellCheck={false} hint={t.timezoneHint} error={error} {...registerProps} />
      <datalist id={listId}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  )
}
