import { ChartNoAxesColumn, ClipboardCheck, ListChecks, LogOut, RotateCcw, ShieldPlus, UserRound } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { Bell } from '@/features/notifications/Bell'
import { useReinspectionVehicles } from '@/features/inspections/queries'

const t = strings.safety

const darkFocus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid'

const nav = [
  { to: '/safety', label: t.nav.penalties, short: t.nav.penalties, icon: ListChecks, end: true },
  { to: '/safety/penalties/new', label: t.nav.issue, short: t.nav.issueShort, icon: ShieldPlus, end: false },
  { to: '/safety/inspections/new', label: t.nav.inspect, short: t.nav.inspect, icon: ClipboardCheck, end: false },
  { to: '/safety/reinspection', label: t.nav.reinspection, short: t.nav.reinspectionShort, icon: RotateCcw, end: false },
  { to: '/safety/summary', label: t.nav.today, short: t.nav.today, icon: ChartNoAxesColumn, end: false },
] as const

const REINSPECTION = '/safety/reinspection'

/** Count bubble for the re-inspection item: amber with ink text, the app's "waiting" colour. */
function Count({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null
  return (
    <span className={cn('grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] leading-5 font-bold text-ink', className)}>
      {count >= 100 ? '99+' : count}
      <span className="sr-only"> {strings.inspections.list.count(count)}</span>
    </span>
  )
}

/**
 * Responsive Safety Officer shell, the same family as the supervisor's. Desktop (lg): brand red sidebar with the logo,
 * navigation, account and sign out. Phone and tablet: red top bar plus bottom tabs.
 */
export default function SafetyLayout() {
  const { profile } = useSession()
  const { signOut } = useAuth()
  const reinspection = useReinspectionVehicles()
  const waiting = reinspection.data?.length ?? 0
  // One bell on the page (its panel and listeners are not meant to exist twice): sidebar on desktop, top bar below.
  const desktop = useMediaQuery('(min-width: 1024px)')

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-brand text-on-solid lg:flex print:hidden">
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <BrandMark className="size-10 bg-surface" />
          <div className="min-w-0">
            <p className="truncate text-base font-bold tracking-tight">{strings.app.name}</p>
            <p className="truncate text-xs text-slate-300">{t.role}</p>
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
                cn('flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold', darkFocus, isActive ? 'bg-accent text-ink' : 'text-slate-300 hover:bg-brand-hover hover:text-on-solid')
              }
            >
              <Icon aria-hidden className="size-5 shrink-0" />
              <span className="flex-1">{label}</span>
              {to === REINSPECTION && <Count count={waiting} />}
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
            {t.account}
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
            <p className="truncate text-sm font-bold tracking-tight">{strings.app.name}</p>
            <p className="truncate text-xs text-slate-300">{profile.name}</p>
          </div>
          {!desktop && <Bell tone="dark" />}
          <Link to="/settings" aria-label={t.account} title={t.account} className={cn('inline-flex size-11 items-center justify-center rounded-lg hover:bg-brand-hover', darkFocus)}>
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

      <div className="pb-20 lg:pb-0 lg:pl-64 print:p-0">
        <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
          <Outlet />
        </main>
      </div>

      {/* Phone and tablet bottom tabs */}
      <nav aria-label={t.mainNav} className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
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
                  {to === REINSPECTION && <Count count={waiting} className="absolute -top-2 -right-3.5" />}
                </span>
                {short}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
