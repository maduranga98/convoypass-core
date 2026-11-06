import { signInWithEmailAndPassword } from 'firebase/auth'
import { Check, Circle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { PasswordInput } from '@/features/auth/PasswordInput'
import { useAuth } from '@/features/auth/useAuth'
import { changeOwnPassword } from '@/lib/api'
import { apiErrorReason } from '@/lib/errors'
import { auth } from '@/lib/firebase'
import { checkOperatorPassword, operatorPasswordAcceptable } from '@/lib/operatorPassword'
import { OPERATOR_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { platformLoginUrl, safePlatformPath } from './redirect'
import { reauthenticate, WrongPassword } from './reauth'
import { usePrivateMeta } from './usePrivateMeta'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.platformAuth.changePassword

/**
 * `/platform/change-password`. Forced while `operators/{uid}.mustChangePassword` is true (the guard sends the operator
 * here before anything else); also reachable from the top bar. The current password is re-checked first (that also gives
 * the fresh sign-in `changeOwnPassword` needs), the new one is 14+ characters, not common and not the email.
 */
export default function PlatformChangePasswordPage() {
  usePrivateMeta()
  const { operator, refreshOperator } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const forced = operator?.mustChangePassword === true
  const email = operator?.email ?? ''
  const checks = checkOperatorPassword(next, email)
  const acceptable = operatorPasswordAcceptable(checks)
  const target = safePlatformPath(params.get('next')) ?? OPERATOR_HOME

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (current === '') return setError(t.currentRequired)
    if (!acceptable) return setError(t.rules.length)
    if (confirm !== next) return setError(t.mismatch)
    setBusy(true)
    try {
      await reauthenticate(current)
      await changeOwnPassword({ newPassword: next })
      // The password changed under the old session: sign in again with the new one, then refresh token and profile.
      if (email) await signInWithEmailAndPassword(auth, email, next)
      await auth.currentUser?.getIdToken(true)
      await refreshOperator()
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.success(t.done)
      navigate(target, { replace: true })
    } catch (err) {
      if (err instanceof WrongPassword) setError(t.currentWrong)
      else if (apiErrorReason(err) === 'recent-login-required') navigate(platformLoginUrl(target, 'reauth'), { replace: true })
      else setError(apiErrorReason(err) === 'invalid-input' ? t.rules.notCommon : t.failed)
    } finally {
      setBusy(false)
    }
  }

  const rules = [
    [checks.length, t.rules.length],
    [checks.notEmail, t.rules.notEmail],
    [checks.notCommon, t.rules.notCommon],
  ] as const

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-xs font-semibold uppercase tracking-wide text-slate-700">{strings.platformAuth.label}</p>
        <div className="rounded-xl border border-slate-300 bg-surface p-6">
          <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{forced ? t.forcedIntro : t.intro}</p>
          {error && <NotificationBanner tone="error" className="mt-4">{error}</NotificationBanner>}
          <form onSubmit={(e) => void submit(e)} className="mt-5 space-y-4" noValidate>
            <PasswordInput label={t.current} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <PasswordInput label={t.new} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <ul className="space-y-1 text-sm" aria-label={t.rulesLabel}>
              {rules.map(([ok, label]) => (
                <li key={label} className={ok ? 'flex items-center gap-2 text-ink' : 'flex items-center gap-2 text-slate-600'}>
                  {ok ? <Check aria-hidden className="size-4" /> : <Circle aria-hidden className="size-4" />}
                  {label}
                </li>
              ))}
            </ul>
            <PasswordInput label={t.confirm} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <Button type="submit" className="w-full" loading={busy} disabled={!acceptable || confirm === ''}>
              {busy ? t.submitting : t.submit}
            </Button>
          </form>
          {!forced && (
            <p className="mt-4 text-center">
              <Link to={target} className="inline-flex min-h-11 items-center px-3 text-sm text-slate-700 underline underline-offset-2">{t.back}</Link>
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
