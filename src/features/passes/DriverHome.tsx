import { CircleHelp, LogOut, ScanLine, TriangleAlert } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ErrorState } from '@/components/ui/ErrorState'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { Bell } from '@/features/notifications/Bell'
import { PermitsCard } from '@/features/qualifications/PermitsCard'
import { PushOptInCard } from '@/features/notifications/PushOptInCard'
import { SimpleMenu } from '@/features/shared/SimpleMenu'
import type { PassStatus } from '@/types/passes'
import { todayKey, useMyPasses, useMyVehicles, useTenant } from './queries'

const t = strings.driverHome

// The camera library is large: its own chunk, loaded when the scan button is pressed.
const QrScanner = lazy(() => import('@/features/scan/QrScanner').then((m) => ({ default: m.QrScanner })))

type Chip = PassStatus | 'none'

/** One status vocabulary (CLAUDE.md): approved/let in = success fill, waiting = amber, fix needed = danger. */
const CHIP_CLASS: Record<Chip, string> = {
  none: 'border-2 border-slate-300 text-slate-700',
  submitted: 'bg-accent text-ink',
  supervisor_approved: 'bg-accent text-ink',
  officer_approved: 'bg-success-strong text-on-solid',
  checked_in: 'bg-success-strong text-on-solid',
  rejected: 'bg-danger-strong text-on-solid',
}

function StatusChip({ status }: { status: Chip }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-3 py-1 text-base font-bold', CHIP_CLASS[status])}>{t.chips[status]}</span>
}

/**
 * `/driver` (Module 12): the simplest possible screen. A greeting, ONE giant "Scan vehicle QR" button, one hint line,
 * then today's vehicles with a plain chip. Cards are not tappable (scanning the sticker proves the driver is at the
 * vehicle), except "Fix needed", which reopens that vehicle's check. Sign out and Help sit in the menu.
 */
export default function DriverHome() {
  const { claims, uid, profile } = useSession()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const tenant = useTenant(claims.tenantId)
  const vehicles = useMyVehicles(claims.tenantId, uid)
  const passes = useMyPasses(claims.tenantId, uid)
  const today = todayKey(tenant.data)
  const [scanning, setScanning] = useState(false)
  const [help, setHelp] = useState(false)

  const todayPass = (vehicleId: string) => passes.data?.find((p) => p.vehicleId === vehicleId && p.dateKey === today)
  const reload = () => {
    void vehicles.refetch()
    passes.retry()
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-5 px-4 py-5 text-lg">
      <header className="flex items-center justify-between gap-2">
        <h1 className="min-w-0 truncate text-2xl font-extrabold tracking-tight text-ink">{t.hello(profile.name)}</h1>
        <div className="flex shrink-0 items-center gap-1">
          <Bell />
          <SimpleMenu
            label={t.menu}
            items={[
              { label: t.help, icon: <CircleHelp aria-hidden className="size-6" />, onSelect: () => setHelp(true) },
              { label: strings.common.signOut, icon: <LogOut aria-hidden className="size-6" />, onSelect: () => void signOut() },
            ]}
          />
        </div>
      </header>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setScanning(true)}
          className="flex h-28 w-full items-center justify-center gap-4 rounded-3xl bg-brand text-3xl font-black tracking-tight text-on-solid shadow-sm hover:bg-brand-hover focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ScanLine aria-hidden className="size-11" />
          {t.scan}
        </button>
        <p className="text-center text-lg text-slate-700">{t.hint}</p>
      </div>

      <section aria-labelledby="today-h" className="space-y-3">
        <h2 id="today-h" className="text-xl font-bold text-ink">{t.todayTitle}</h2>
        {vehicles.isPending || passes.isPending ? (
          <div role="status" className="space-y-3">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : vehicles.isError || passes.isError ? (
          <ErrorState message={t.loadFailed} onRetry={reload} />
        ) : vehicles.data.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-400 p-5 text-center text-slate-700">{t.vehiclesEmpty}</p>
        ) : (
          <ul className="space-y-3" data-testid="today-list">
            {vehicles.data.map((v) => {
              const pass = todayPass(v.id)
              const status: Chip = pass?.status ?? 'none'
              if (pass && status === 'rejected') {
                // The only tappable card: it reopens the check so the driver can fix it.
                return (
                  <li key={v.id}>
                    <Link
                      to={`/v/${v.id}`}
                      className="block space-y-2 rounded-2xl border-2 border-danger-strong bg-danger-soft p-4 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      <span className="flex items-center gap-3">
                        <TriangleAlert aria-hidden className="size-7 shrink-0 text-danger-strong" />
                        <span className="min-w-0 flex-1 text-xl font-bold text-ink">{v.plateNo}</span>
                        <StatusChip status="rejected" />
                      </span>
                      {pass.rejection?.reason && (
                        <span className="block text-base text-danger-ink">
                          {t.reason}: {pass.rejection.reason}
                        </span>
                      )}
                      <span className="block text-base font-bold text-danger-ink underline underline-offset-2">{t.fixNow}</span>
                    </Link>
                  </li>
                )
              }
              return (
                <li key={v.id} className="flex min-h-16 items-center gap-3 rounded-2xl border border-slate-300 bg-surface px-4 py-3">
                  <span className="min-w-0 flex-1 text-xl font-bold text-ink">{v.plateNo}</span>
                  <StatusChip status={status} />
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <PermitsCard />

      <PushOptInCard />

      <Modal open={help} onClose={() => setHelp(false)} title={t.helpTitle} variant="sheet">
        <ol className="list-decimal space-y-2 pl-6 text-lg">
          {t.helpSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-4 text-lg font-semibold">{t.helpMore}</p>
      </Modal>

      {scanning && (
        <Suspense fallback={<div role="status" className="fixed inset-0 z-50 grid place-items-center bg-scrim text-lg font-semibold text-on-solid">{strings.scanner.starting}</div>}>
          <QrScanner onClose={() => setScanning(false)} onVehicle={(id) => void navigate(`/v/${id}`, { state: { from: 'scan' } })} />
        </Suspense>
      )}
    </div>
  )
}
