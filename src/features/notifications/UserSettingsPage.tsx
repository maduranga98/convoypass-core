import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { AccountDetails } from '@/features/account/AccountDetails'
import { ChangeCredentialCard } from '@/features/account/ChangeCredentialCard'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'
import { isPinRole } from '@/lib/session'
import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { LogOut } from 'lucide-react'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/cn'
import { ROLE_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { readPushEnv } from './push/env'
import { disablePush, enablePush, isPushEnabledHere } from './push/registration'

const t = strings.push

/** `/settings`: drivers and security see only who they are and Sign out (Module 12); office staff get the full page. */
export default function UserSettingsPage() {
  const { claims } = useSession()
  return isPinRole(claims.role) ? <PinUserSettings /> : <StaffSettings />
}

/** Name, role, company and Sign out. No PIN or password screens: a lost PIN is reissued by a supervisor or admin. */
function PinUserSettings() {
  const { claims, profile } = useSession()
  const { signOut } = useAuth()
  const tenant = useTenant(claims.tenantId)
  const contractorId = claims.contractorId
  // Drivers may read their own contractor document (and only that one).
  const contractor = useQuery({
    queryKey: ['contractor-name', contractorId],
    enabled: Boolean(contractorId),
    staleTime: 5 * 60_000,
    queryFn: async () => ((await getDoc(doc(db, 'contractors', contractorId as string))).data() as { name?: string } | undefined)?.name ?? null,
  })
  const company = contractorId ? contractor.data : tenant.data?.name
  const a = strings.account
  const rows: [string, string][] = [
    [a.name, profile.name],
    [a.role, strings.roles[claims.role]],
    [a.company, company ?? (contractor.isLoading || tenant.isLoading ? strings.common.loading : strings.common.none)],
  ]
  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-6 px-4 py-6 text-lg">
      <Link to={ROLE_HOME[claims.role]} className="inline-flex min-h-14 items-center gap-1 font-semibold text-slate-700 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
        <ArrowLeft aria-hidden className="size-5" />
        {strings.userSettings.back}
      </Link>
      <h1 className="text-2xl font-extrabold tracking-tight">{strings.userSettings.title}</h1>
      <dl className="divide-y divide-slate-200 rounded-2xl border border-slate-300 bg-surface">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-slate-600">{k}</dt>
            <dd className="text-right font-bold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={() => void signOut()}
        className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl border-2 border-slate-300 bg-surface text-xl font-bold text-ink hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <LogOut aria-hidden className="size-6" />
        {strings.common.signOut}
      </button>
    </div>
  )
}

function StaffSettings() {
  const { uid, claims } = useSession()
  const [env, setEnv] = useState(readPushEnv)
  const [on, setOn] = useState(() => isPushEnabledHere(uid))
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    setBusy(true)
    try {
      if (on) {
        await disablePush(uid)
        setOn(false)
      } else {
        const result = await enablePush(uid)
        setOn(result === 'enabled')
        if (result === 'enabled') toast.success(t.enabledToast)
        else toast.error(result === 'denied' ? t.deniedToast : result === 'unsupported' ? t.unsupported : result === 'unconfigured' ? t.needsConfig : t.failedToast)
      }
    } finally {
      setEnv(readPushEnv())
      setBusy(false)
    }
  }

  const installFirst = env.ios === 'needs-install'
  const blocked = env.permission === 'denied'
  const canToggle = !installFirst && env.supported && (on || !blocked) && claims.role !== 'security' && claims.role !== 'yard'
  const permissionText =
    env.permission === 'granted' ? t.permissionGranted : env.permission === 'denied' ? t.permissionDenied : env.permission === 'default' ? t.permissionDefault : t.unsupported

  return (
    <div className="mx-auto min-h-dvh max-w-2xl space-y-6 px-4 py-6">
      <Link to={ROLE_HOME[claims.role]} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-700 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
        <ArrowLeft aria-hidden className="size-4" />
        {strings.userSettings.back}
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">{strings.userSettings.title}</h1>

      <section aria-labelledby="alerts-h" className="space-y-4 rounded-xl border border-slate-200 bg-surface p-4">
        <h2 id="alerts-h" className="font-semibold">{t.settingsTitle}</h2>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p id="device-toggle-label" className="text-sm font-medium">{t.deviceTitle}: {t.toggle}</p>
            <p id="device-toggle-status" className="text-sm text-slate-700">{on ? t.statusOn : t.statusOff}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="device-toggle-label"
            aria-describedby="device-toggle-status"
            disabled={!canToggle || busy}
            onClick={() => void toggle()}
            className={cn(
              'relative inline-flex h-11 w-16 shrink-0 items-center rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50',
              on ? 'border-brand bg-brand' : 'border-slate-500 bg-surface',
            )}
          >
            <span aria-hidden className={cn('inline-block size-7 rounded-full transition-transform', on ? 'translate-x-7 bg-surface' : 'translate-x-1 bg-slate-500')} />
          </button>
        </div>

        {installFirst ? (
          <div role="note" className="rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning-ink">
            <p className="font-semibold">{t.iosTitle}</p>
            <p>{t.iosBody}</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">{t.iosSteps.map((s) => <li key={s}>{s}</li>)}</ol>
          </div>
        ) : (
          <p data-testid="permission-status" className={cn('text-sm', blocked ? 'text-danger-ink' : 'text-slate-700')}>{permissionText}</p>
        )}
        <p className="text-sm text-slate-600">{t.otherDevices}</p>
      </section>

      <section aria-labelledby="account-h" className="space-y-6 rounded-xl border border-slate-200 bg-surface p-4">
        <h2 id="account-h" className="font-semibold">{strings.userSettings.account}</h2>
        <AccountDetails />
        <ChangeCredentialCard />
      </section>
    </div>
  )
}
