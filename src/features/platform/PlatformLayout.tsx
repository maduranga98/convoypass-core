import { Building2, KeyRound, LayoutDashboard, LogOut, Mail } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useAuth } from '@/features/auth/useAuth'
import { changePasswordUrl } from './redirect'
import { usePrivateMeta } from './usePrivateMeta'

const t = strings.platform
const topBar = strings.platformAuth.topBar

const nav = [
  { to: '/platform', label: t.nav.overview, icon: LayoutDashboard, end: true },
  { to: '/platform/workspaces', label: t.nav.workspaces, icon: Building2, end: false },
  { to: '/platform/invites', label: t.nav.invites, icon: Mail, end: false },
] as const

const darkFocus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid'
const darkItem = cn('flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-300 hover:bg-brand-hover hover:text-on-solid', darkFocus)

/**
 * Super admin console shell, the same family as the workspace roles: a fixed brand red sidebar on desktop (logo, a
 * "Super admin console" label so it is never mistaken for a client workspace, navigation, account pinned at the bottom),
 * a red top bar plus bottom tabs below lg. No notification bell, no workspace navigation.
 */
export default function PlatformLayout() {
  usePrivateMeta()
  const { operator, signOut } = useAuth()
  const location = useLocation()
  const passwordLink = changePasswordUrl(location.pathname + location.search)

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-brand text-on-solid lg:flex">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <BrandMark className="size-10 bg-surface" />
          <div className="min-w-0">
            <p className="truncate text-base font-bold tracking-tight">{strings.app.name}</p>
            <p className="truncate text-xs text-slate-300">{t.label}</p>
          </div>
        </div>
        <nav aria-label={t.navLabel} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2">
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
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1 border-t border-slate-700 p-3">
          <p className="truncate px-3 pb-1 text-sm font-semibold">{operator?.email}</p>
          <Link to={passwordLink} className={darkItem}>
            <KeyRound aria-hidden className="size-5" />
            {topBar.changePassword}
          </Link>
          <button type="button" onClick={() => void signOut()} className={cn(darkItem, 'w-full')}>
            <LogOut aria-hidden className="size-5" />
            {topBar.signOut}
          </button>
        </div>
      </aside>

      {/* Phone and tablet top bar */}
      <header className="sticky top-0 z-20 bg-brand text-on-solid lg:hidden">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          <BrandMark className="size-9 bg-surface" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold tracking-tight">{t.label}</p>
            <p className="truncate text-xs text-slate-300">{operator?.email}</p>
          </div>
          <Link to={passwordLink} aria-label={topBar.changePassword} title={topBar.changePassword} className={cn('inline-flex size-11 items-center justify-center rounded-lg hover:bg-brand-hover', darkFocus)}>
            <KeyRound aria-hidden className="size-5" />
          </Link>
          <button
            type="button"
            aria-label={topBar.signOut}
            title={topBar.signOut}
            onClick={() => void signOut()}
            className={cn('inline-flex size-11 items-center justify-center rounded-lg hover:bg-brand-hover', darkFocus)}
          >
            <LogOut aria-hidden className="size-5" />
          </button>
        </div>
      </header>

      <div className="pb-20 lg:pb-0 lg:pl-64">
        <main className="mx-auto max-w-5xl px-4 py-6 lg:px-8 lg:py-10">
          <Outlet />
        </main>
      </div>

      {/* Phone and tablet bottom tabs */}
      <nav aria-label={t.navLabel} className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
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
                <Icon aria-hidden className="size-5" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
