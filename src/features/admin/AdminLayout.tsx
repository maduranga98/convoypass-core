import { BadgeCheck, Building2, CalendarCheck, ChartNoAxesColumn, ClipboardList, FileBarChart, Footprints, GraduationCap, History, LayoutDashboard, LogOut, Menu, QrCode, Settings, ShieldAlert, Tags, Truck, UserRound, Users, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { Bell } from '@/features/notifications/Bell'
import { PushOptInCard } from '@/features/notifications/PushOptInCard'

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean }

const navGroups: ReadonlyArray<{ label: string; items: readonly NavItem[] }> = [
  {
    label: strings.admin.navGroups.overview,
    items: [
      { to: '/admin/dashboard', label: strings.admin.nav.dashboard, icon: LayoutDashboard },
      { to: '/admin/summary', label: strings.admin.nav.today, icon: ChartNoAxesColumn },
    ],
  },
  {
    label: strings.admin.navGroups.operations,
    items: [
      { to: '/admin/passes', label: strings.admin.nav.passes, icon: ClipboardList },
      { to: '/admin/visits', label: strings.admin.nav.visits, icon: Footprints },
      { to: '/admin/gate-passes', label: strings.gatePasses.nav, icon: BadgeCheck, end: true },
      { to: '/admin/gate-passes/month-end', label: strings.gatePasses.navQualification, icon: CalendarCheck },
    ],
  },
  {
    label: strings.admin.navGroups.fleet,
    items: [
      { to: '/admin/contractors', label: strings.admin.nav.contractors, icon: Building2 },
      { to: '/admin/vehicles', label: strings.admin.nav.vehicles, icon: Truck },
      { to: '/admin/drivers', label: strings.admin.nav.drivers, icon: UserRound },
      { to: '/admin/users', label: strings.admin.nav.users, icon: Users },
      { to: '/admin/qr', label: strings.admin.nav.qr, icon: QrCode },
    ],
  },
  {
    label: strings.admin.navGroups.compliance,
    items: [
      { to: '/admin/qualifications', label: strings.qualifications.nav, icon: GraduationCap },
      { to: '/admin/penalties', label: strings.admin.nav.penalties, icon: ShieldAlert },
      { to: '/admin/penalty-types', label: strings.admin.nav.penaltyTypes, icon: Tags },
    ],
  },
  {
    label: strings.admin.navGroups.insights,
    items: [
      { to: '/admin/reports', label: strings.admin.nav.reports, icon: FileBarChart },
      { to: '/admin/audit', label: strings.audit.nav, icon: History },
    ],
  },
  {
    label: strings.admin.navGroups.system,
    items: [{ to: '/admin/settings', label: strings.admin.nav.settings, icon: Settings }],
  },
]

const darkFocus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid'

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label={strings.admin.panel} className="space-y-4">
      {navGroups.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-300">{group.label}</p>
          <div className="space-y-0.5">
            {group.items.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold',
                    darkFocus,
                    isActive ? 'bg-accent text-ink' : 'text-slate-300 hover:bg-brand-hover hover:text-on-solid',
                  )
                }
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                {label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

function SignOutButton({ iconOnly }: { iconOnly?: boolean }) {
  const { signOut } = useAuth()
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      aria-label={iconOnly ? strings.common.signOut : undefined}
      title={iconOnly ? strings.common.signOut : undefined}
      className={cn(
        'flex items-center text-sm font-medium text-slate-300 hover:bg-brand-hover hover:text-on-solid',
        darkFocus,
        iconOnly ? 'size-11 justify-center rounded-lg' : 'h-11 w-full gap-3 rounded-lg px-3',
      )}
    >
      <LogOut aria-hidden className="size-5" />
      {!iconOnly && strings.common.signOut}
    </button>
  )
}

/**
 * Responsive shell, the same family as the supervisor and officer. Desktop (lg): a fixed brand red sidebar whose
 * navigation scrolls on its own, so the account and sign out stay pinned to the bottom of the screen however long the
 * list is. Below lg: a red top bar (bell, sign out, menu) and a scrollable menu sheet.
 */
export default function AdminLayout() {
  const { profile } = useSession()
  const [open, setOpen] = useState(false)
  // One bell on the page: sidebar on desktop, top bar below.
  const desktop = useMediaQuery('(min-width: 1024px)')

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-brand text-on-solid lg:flex print:hidden">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <BrandMark className="size-10 bg-surface" />
          <div className="min-w-0">
            <p className="truncate text-base font-bold tracking-tight">{strings.app.name}</p>
            <p className="truncate text-xs text-slate-300">{strings.admin.panel}</p>
          </div>
          {desktop && <Bell tone="dark" align="left" className="ml-auto" />}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <NavItems />
        </div>
        <div className="space-y-1 border-t border-slate-700 p-3">
          <div className="px-3 pb-1">
            <p className="truncate text-sm font-semibold">{profile.name}</p>
            <p className="truncate text-xs text-slate-300">{strings.admin.panel}</p>
          </div>
          <SignOutButton />
        </div>
      </aside>

      {/* Phone and tablet top bar */}
      <header className="sticky top-0 z-30 bg-brand text-on-solid lg:hidden print:hidden">
        <div className="flex h-14 items-center gap-2 px-4">
          <BrandMark className="size-9 bg-surface" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold tracking-tight">{strings.app.name}</p>
            <p className="truncate text-xs text-slate-300">{profile.name}</p>
          </div>
          {!desktop && <Bell tone="dark" />}
          <SignOutButton iconOnly />
          <button
            type="button"
            aria-expanded={open}
            aria-controls="admin-mobile-menu"
            aria-label={open ? strings.common.closeMenu : strings.common.openMenu}
            onClick={() => setOpen((o) => !o)}
            className={cn('inline-flex size-11 items-center justify-center rounded-lg hover:bg-brand-hover', darkFocus)}
          >
            {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </button>
        </div>
        {open && (
          <div id="admin-mobile-menu" className="absolute inset-x-0 top-full max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain border-t border-slate-700 bg-brand p-3 shadow-lg">
            <NavItems onNavigate={() => setOpen(false)} />
          </div>
        )}
      </header>

      <div className="lg:pl-64 print:p-0">
        <main className="min-w-0 px-4 py-6 lg:px-10 lg:py-10 print:p-0">
          <div className="mx-auto max-w-5xl print:max-w-none">
            <div className="pb-6 empty:hidden print:hidden"><PushOptInCard /></div>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
