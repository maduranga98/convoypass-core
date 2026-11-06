import { FirebaseError } from 'firebase/app'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageSpinner } from '@/components/ui/Spinner'
import { isOperatorToken } from '@/features/auth/claims'
import { PasswordInput } from '@/features/auth/PasswordInput'
import { useAuth } from '@/features/auth/useAuth'
import { getOperatorProfile, getSuperAdminSignupStatus } from '@/lib/api'
import { auth } from '@/lib/firebase'
import { OPERATOR_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { PLATFORM_SIGNUP, peekLoginReason, safePlatformPath, setLoginReason } from './redirect'
import { usePrivateMeta } from './usePrivateMeta'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.platformAuth
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Failure = 'mismatch' | 'network' | 'tooMany'

/**
 * Only a network failure and rate limiting are told apart; everything else (wrong password, unknown email, a workspace
 * account, a disabled or half-made super admin) is the SAME message, so the page can never be used to learn which accounts exist.
 */
const failureOf = (e: unknown): Failure => {
  const code = e instanceof FirebaseError ? e.code : ''
  if (code === 'auth/network-request-failed' || code === 'functions/unavailable' || code === 'functions/deadline-exceeded') return 'network'
  if (code === 'auth/too-many-requests') return 'tooMany'
  return 'mismatch'
}

/**
 * Public, lazy, noindex. After Firebase accepts the password the page reads the claims from a fresh token and asks
 * `getOperatorProfile`; anything but a valid, active super admin is signed out immediately.
 */
export default function PlatformLoginPage() {
  usePrivateMeta()
  const { status, operator } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>({})
  const attempt = useRef(0)
  // The signup link only appears when the server says signup is on (always in the emulator, opt-in elsewhere).
  const [signupOn, setSignupOn] = useState(false)
  useEffect(() => {
    let live = true
    getSuperAdminSignupStatus({}).then(
      (r) => live && setSignupOn(r.enabled),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])

  const from = safePlatformPath(params.get('from')) ?? OPERATOR_HOME
  const reason = params.get('reason') ?? peekLoginReason()
  // The idle reason is shown once.
  useEffect(() => {
    setLoginReason(undefined)
  }, [])

  if (status === 'loading') return <PageSpinner />
  // Already a signed-in super admin (and not mid-attempt): straight to where they were going.
  // (After a stale-login redirect the form must stay: signing in again is the whole point.)
  if (operator && !busy && reason !== 'reauth') return <Navigate to={from} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: { email?: string; password?: string } = {}
    if (!EMAIL.test(email.trim())) errs.email = t.invalidEmail
    if (password === '') errs.password = t.passwordRequired
    setFieldError(errs)
    if (errs.email || errs.password) return

    const mine = ++attempt.current
    setBusy(true)
    setFailure(null)
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password)
      const token = await cred.user.getIdTokenResult(true)
      if (!isOperatorToken(token.claims)) throw new Error('not-an-operator')
      await getOperatorProfile({})
      setPassword('')
      navigate(from, { replace: true })
    } catch (err) {
      // Whatever it was, nobody who is not a valid super admin stays signed in here.
      await signOut(auth).catch(() => undefined)
      if (mine === attempt.current) setFailure(failureOf(err))
    } finally {
      if (mine === attempt.current) setBusy(false)
    }
  }

  const notice = reason === 'reauth' ? t.reauthNotice : reason === 'idle' ? t.idleNotice : null

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-slate-700">
          <ShieldCheck aria-hidden className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">{t.label}</span>
        </div>
        <div className="rounded-xl border border-slate-300 bg-surface p-6">
          <h1 className="text-xl font-semibold tracking-tight">{t.loginTitle}</h1>
          <p className="mt-1 text-sm text-slate-600">{t.loginIntro}</p>

          {notice && !failure && <p role="status" className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">{notice}</p>}
          {failure && (
            <NotificationBanner tone="error" className="mt-4">{t[failure]}</NotificationBanner>
          )}

          <form onSubmit={(e) => void submit(e)} className="mt-5 space-y-4" noValidate>
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
            <PasswordInput
              label={t.password}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fieldError.password}
            />
            <Button type="submit" className="w-full" loading={busy}>
              {busy ? t.signingIn : t.signIn}
            </Button>
          </form>
        </div>
        {signupOn && (
          <p className="mt-4 text-center">
            <Link to={PLATFORM_SIGNUP} className="inline-flex min-h-11 items-center px-3 text-sm text-slate-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus">
              {strings.platformAuth.signup.link}
            </Link>
          </p>
        )}
      </div>
    </main>
  )
}
