import { BarChart3, ChartNoAxesColumn, ClipboardCheck, FileText, GraduationCap, LogOut, UserRound } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { usePendingCount } from '@/features/passes/usePendingCount'
import { Bell } from '@/features/notifications/Bell'
import { PushOptInCard } from '@/features/notifications/PushOptInCard'

const t = strings.officer

const nav = [
  { to: '/officer', label: t.nav.queue, icon: ClipboardCheck, end: true },
  { to: '/officer/qualifications', label: strings.qualifications.nav, icon: GraduationCap, end: false },
  { to: '/officer/overview', label: t.nav.overview, icon: BarChart3, end: false },
  { to: '/officer/summary', label: t.nav.visits, icon: ChartNoAxesColumn, end: false },
  { to: '/officer/reports', label: t.nav.reports, icon: FileText, end: false },
] as const

const darkFocus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid'

/** Count bubble for the Approvals item: amber with red text, the app's "waiting" colour. */
function PendingBadge({ count, capped, className }: { count: number | null; capped: boolean; className?: string }) {
  if (count === null || count === 0) return null
  return (
    <span aria-label={t.pendingBadge(count)} className={cn('grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold leading-5 text-ink', className)}>
      {capped || count >= 100 ? '99+' : count}
    </span>
  )
}

/**
 * Responsive shell, the same family as the supervisor's. Desktop (lg): a brand red sidebar with the logo, navigation,
 * account and sign out. Phone and tablet: a red top bar and bottom tabs (the review panel covers both while open).
 */
export default function OfficerLayout() {
  const { profile } = useSession()
  const { signOut } = useAuth()
  const { count, capped } = usePendingCount('officer') // also keeps the queue listener warm for the other officer screens
  const location = useLocation()
  const reviewing = location.pathname === '/officer' && new URLSearchParams(location.search).has('pass')
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
                cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold',
                  darkFocus,
                  isActive ? 'bg-accent text-ink' : 'text-slate-300 hover:bg-brand-hover hover:text-on-solid',
                )
              }
            >
              <Icon aria-hidden className="size-5 shrink-0" />
              <span className="flex-1">{label}</span>
              {to === '/officer' && <PendingBadge count={count} capped={capped} className="bg-surface" />}
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
            <p className="truncate text-sm font-bold tracking-tight">{strings.app.name}</p>
            <p className="truncate text-xs text-slate-300">{profile.name} · {t.role}</p>
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

      <div className="pb-20 lg:pb-0 lg:pl-64 print:p-0">
        <main className="min-w-0">
          {/* Not while reviewing: the pass itself has to be the first thing on screen. */}
          {!reviewing && <div className="px-4 pt-4 empty:hidden sm:px-6 lg:px-8 print:hidden"><PushOptInCard /></div>}
          <Outlet />
        </main>
      </div>

      {/* Phone and tablet bottom tabs */}
      <nav aria-label={t.mainNav} className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
        <ul className="mx-auto grid max-w-3xl grid-cols-3">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                    isActive ? 'text-ink before:absolute before:inset-x-6 before:top-0 before:h-1 before:rounded-b-full before:bg-accent' : 'text-slate-600 hover:text-ink',
                  )
                }
              >
                <span className="relative">
                  <Icon aria-hidden className="size-5" />
                  {to === '/officer' && <PendingBadge count={count} capped={capped} className="absolute -right-3.5 -top-2" />}
                </span>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
