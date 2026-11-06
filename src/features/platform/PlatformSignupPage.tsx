import { signInWithEmailAndPassword } from 'firebase/auth'
import { Check, Circle, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageSpinner } from '@/components/ui/Spinner'
import { PasswordInput } from '@/features/auth/PasswordInput'
import { useAuth } from '@/features/auth/useAuth'
import { getSuperAdminSignupStatus, signUpSuperAdmin } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { auth } from '@/lib/firebase'
import { checkOperatorPassword, operatorPasswordAcceptable } from '@/lib/operatorPassword'
import { OPERATOR_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { PLATFORM_LOGIN } from './redirect'
import { usePrivateMeta } from './usePrivateMeta'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.platformAuth.signup
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Availability = 'checking' | 'enabled' | 'disabled'

/**
 * `/platform/signup`: create a super admin account in the browser. Public, lazy, noindex. The server decides whether signup
 * is on (always in the emulator, `ALLOW_SUPERADMIN_SIGNUP=true` elsewhere); when it is off this page says so and creates nothing.
 * After the account exists the page signs in and lands on /platform.
 */
export default function PlatformSignupPage() {
  usePrivateMeta()
  const { status, operator } = useAuth()
  const navigate = useNavigate()
  const [availability, setAvailability] = useState<Availability>('checking')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ name?: string; email?: string; confirm?: string }>({})

  useEffect(() => {
    let live = true
    getSuperAdminSignupStatus({}).then(
      (r) => live && setAvailability(r.enabled ? 'enabled' : 'disabled'),
      () => live && setAvailability('disabled'),
    )
    return () => {
      live = false
    }
  }, [])

  const checks = checkOperatorPassword(password, email)
  const acceptable = operatorPasswordAcceptable(checks)

  if (status === 'loading') return <PageSpinner />
  if (operator && !busy) return <Navigate to={OPERATOR_HOME} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: typeof fieldError = {}
    if (name.trim() === '') errs.name = t.nameRequired
    if (!EMAIL.test(email.trim())) errs.email = strings.platformAuth.invalidEmail
    if (confirm !== password) errs.confirm = t.mismatch
    setFieldError(errs)
    setError(null)
    if (errs.name || errs.email || errs.confirm) return
    if (!acceptable) return setError(t.weak)

    setBusy(true)
    try {
      await signUpSuperAdmin({ name: name.trim(), email: email.trim(), password })
      await signInWithEmailAndPassword(auth, email.trim(), password)
      setPassword('')
      setConfirm('')
      navigate(OPERATOR_HOME, { replace: true })
    } catch (err) {
      setError(apiErrorMessage(err) || t.failed)
    } finally {
      setBusy(false)
    }
  }

  const rules = [
    [checks.length, strings.platformAuth.changePassword.rules.length],
    [checks.notEmail, strings.platformAuth.changePassword.rules.notEmail],
    [checks.notCommon, strings.platformAuth.changePassword.rules.notCommon],
  ] as const

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-slate-700">
          <ShieldCheck aria-hidden className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">{strings.platformAuth.label}</span>
        </div>
        <div className="rounded-xl border border-slate-300 bg-surface p-6">
          {availability === 'checking' && <p role="status" className="text-sm text-slate-600">{t.checking}</p>}

          {availability === 'disabled' && (
            <>
              <h1 className="text-xl font-semibold tracking-tight">{t.disabledTitle}</h1>
              <p className="mt-1 text-sm text-slate-600">{t.disabledBody}</p>
            </>
          )}

          {availability === 'enabled' && (
            <>
              <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
              <p className="mt-1 text-sm text-slate-600">{t.intro}</p>
              {error && <NotificationBanner tone="error" className="mt-4">{error}</NotificationBanner>}
              <form onSubmit={(e) => void submit(e)} className="mt-5 space-y-4" noValidate>
                <Input label={t.name} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fieldError.name} />
                <Input
                  label={t.email}
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={fieldError.email}
                />
                <PasswordInput label={t.password} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <ul className="space-y-1 text-sm" aria-label={t.rulesLabel}>
                  {rules.map(([ok, label]) => (
                    <li key={label} className={ok ? 'flex items-center gap-2 text-ink' : 'flex items-center gap-2 text-slate-600'}>
                      {ok ? <Check aria-hidden className="size-4" /> : <Circle aria-hidden className="size-4" />}
                      {label}
                    </li>
                  ))}
                </ul>
                <PasswordInput label={t.confirm} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={fieldError.confirm} />
                <Button type="submit" className="w-full" loading={busy} disabled={!acceptable || confirm === ''}>
                  {busy ? t.submitting : t.submit}
                </Button>
              </form>
            </>
          )}
        </div>
        <p className="mt-4 text-center">
          <Link to={PLATFORM_LOGIN} className="inline-flex min-h-11 items-center px-3 text-sm text-slate-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus">
            {t.backToSignIn}
          </Link>
        </p>
      </div>
    </main>
  )
}
