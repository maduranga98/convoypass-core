import { CalendarCheck, ClipboardCheck, Footprints, Home, LogOut, QrCode, ShieldAlert, Truck, UserRound, UserRoundPlus, Users } from 'lucide-react'
import { Link, NavLink, Outlet, useMatch } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { usePendingCount } from '@/features/passes/usePendingCount'
import { Bell } from '@/features/notifications/Bell'
import { PushOptInCard } from '@/features/notifications/PushOptInCard'
import { useAwaitingReview } from '@/features/penalties/feed'
import { useContractorList } from '@/features/shared/queries'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { useMediaQuery } from '@/lib/useMediaQuery'

const t = strings.supervisor

const nav = [
  { to: '/supervisor', label: t.nav.home, short: t.nav.home, icon: Home, end: true },
  { to: '/supervisor/approvals', label: t.nav.approvals, short: t.nav.approvals, icon: ClipboardCheck, end: false },
  { to: '/supervisor/daily', label: t.nav.daily, short: t.nav.dailyShort, icon: CalendarCheck, end: false },
  { to: '/supervisor/assign-drivers', label: t.nav.assign, short: t.nav.assignShort, icon: UserRoundPlus, end: false },
  { to: '/supervisor/penalties', label: t.nav.penalties, short: t.nav.penalties, icon: ShieldAlert, end: false },
  { to: '/supervisor/visits', label: t.nav.visits, short: t.nav.visits, icon: Footprints, end: false },
  { to: '/supervisor/vehicles', label: t.nav.vehicles, short: t.nav.vehicles, icon: Truck, end: false },
  { to: '/supervisor/drivers', label: t.nav.drivers, short: t.nav.drivers, icon: Users, end: false },
  { to: '/supervisor/qr', label: t.nav.qr, short: t.nav.qrShort, icon: QrCode, end: false },
] as const

const darkFocus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid'

/** Count bubble for the Approvals item: amber with red text, the app's "waiting" colour. */
function PendingBadge({ count, className, label }: { count: number | null; className?: string; label?: string }) {
  if (count === null || count === 0) return null
  return (
    <span aria-label={label ?? t.homePending(count)} className={cn('grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold leading-5 text-ink', className)}>
      {count >= 100 ? '99+' : count}
    </span>
  )
}

/**
 * Responsive shell. Desktop (lg): a brand red sidebar with the logo, navigation, account and sign out. Phone and
 * tablet: a red top bar and a bottom tab bar (hidden on the review screen, which has its own Approve/Reject bar).
 */
export default function SupervisorLayout() {
  const { profile, claims } = useSession()
  const { signOut } = useAuth()
  const contractors = useContractorList('supervisor')
  const { count } = usePendingCount('supervisor')
  const reviews = useAwaitingReview(claims.contractorId !== null)
  const contractorName = contractors.data?.[0]?.name ?? strings.app.name
  const reviewing = useMatch('/supervisor/approvals/:passId') !== null
  // One bell on the page (its panel and listeners are not meant to exist twice): sidebar on desktop, top bar below.
  const desktop = useMediaQuery('(min-width: 1024px)')

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-brand text-on-solid lg:flex print:hidden">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <BrandMark className="size-10 bg-surface" />
          <div className="min-w-0">
            <p className="truncate text-base font-bold tracking-tight">{strings.app.name}</p>
            <p className="truncate text-xs text-slate-300">{contractorName}</p>
          </div>
          {desktop && <Bell tone="dark" align="left" className="ml-auto" />}
        </div>
        <nav aria-label={t.mainNav} className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold',
                  darkFocus,
                  isActive ? 'bg-accent text-ink' : 'text-slate-300 hover:bg-brand-hover hover:text-on-solid',
                )
              }
            >
              <Icon aria-hidden className="size-5 shrink-0" />
              <span className="flex-1">{label}</span>
              {to === '/supervisor/approvals' && <PendingBadge count={count} className="bg-surface" />}
              {to === '/supervisor/penalties' && <PendingBadge count={reviews.waiting.length} label={strings.penalties.verify.badge(reviews.waiting.length)} className="bg-surface" />}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1 border-t border-slate-700 p-3">
          <div className="px-3 pb-1">
            <p className="truncate text-sm font-semibold">{profile.name}</p>
            <p className="truncate text-xs text-slate-300">{t.role}</p>
          </div>
          <Link to="/settings" className={cn('flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-300 hover:bg-brand-hover hover:text-on-solid', darkFocus)}>
            <UserRound aria-hidden className="size-5" />
            {t.nav.account}
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            className={cn('flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-300 hover:bg-brand-hover hover:text-on-solid', darkFocus)}
          >
            <LogOut aria-hidden className="size-5" />
            {strings.common.signOut}
          </button>
        </div>
      </aside>

      {/* Phone and tablet top bar */}
      <header className="sticky top-0 z-20 bg-brand text-on-solid lg:hidden print:hidden">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <BrandMark className="size-9 bg-surface" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold tracking-tight">{contractorName}</p>
            <p className="truncate text-xs text-slate-300">{profile.name}</p>
          </div>
          {!desktop && <Bell tone="dark" />}
          <Link to="/settings" aria-label={t.nav.account} title={t.nav.account} className={cn('inline-flex size-11 items-center justify-center rounded-lg hover:bg-brand-hover', darkFocus)}>
            <UserRound aria-hidden className="size-5" />
          </Link>
          <button
            type="button"
            aria-label={strings.common.signOut}
            title={strings.common.signOut}
            onClick={() => void signOut()}
            className={cn('inline-flex size-11 items-center justify-center rounded-lg hover:bg-brand-hover', darkFocus)}
          >
            <LogOut aria-hidden className="size-5" />
          </button>
        </div>
      </header>

      <div className={cn('lg:pl-64', reviewing ? 'pb-0' : 'pb-20 lg:pb-0', 'print:p-0')}>
        <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
          {/* Not while reviewing: the pass itself has to be the first thing on screen. */}
          {!reviewing && <div className="pb-4 empty:hidden print:hidden"><PushOptInCard /></div>}
          {claims.contractorId ? (
            <Outlet />
          ) : (
            <NotificationBanner tone="warning" role="alert">{t.noContractor}</NotificationBanner>
          )}
        </main>
      </div>

      {/* Phone and tablet bottom tabs */}
      {!reviewing && (
        <nav aria-label={t.mainNav} className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
          <ul className="mx-auto grid max-w-3xl grid-cols-6">
            {nav.map(({ to, short, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                      isActive ? 'text-ink before:absolute before:inset-x-4 before:top-0 before:h-1 before:rounded-b-full before:bg-accent' : 'text-slate-600 hover:text-ink',
                    )
                  }
                >
                  <span className="relative">
                    <Icon aria-hidden className="size-5" />
                    {to === '/supervisor/approvals' && <PendingBadge count={count} className="absolute -right-3.5 -top-2" />}
                    {to === '/supervisor/penalties' && <PendingBadge count={reviews.waiting.length} label={strings.penalties.verify.badge(reviews.waiting.length)} className="absolute -right-3.5 -top-2" />}
                  </span>
                  {short}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
