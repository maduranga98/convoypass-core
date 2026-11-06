import { ChartNoAxesColumn, LogOut, UserRound } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { useQueueSync } from '@/features/gate/gateQueue'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'

const t = strings.visits.yard
const iconButton =
  'inline-flex size-14 shrink-0 items-center justify-center rounded-lg text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/** Mobile-first shell for every `/yard` screen: one row (name, today, account, sign out). The Yard Officer gets no notifications or push. */
export default function YardLayout() {
  const { profile, uid } = useSession()
  // The same offline queue loop as the security screens: on start, on `online`, every 30 s while items wait.
  useQueueSync(uid)
  const { signOut } = useAuth()
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-1.5 px-3">
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <BrandMark className="size-9 rounded-lg" />
            <span className="min-w-0">
              <span className="block truncate text-base font-bold text-ink">{t.role}</span>
              <span className="block truncate text-xs text-slate-700">{profile.name}</span>
            </span>
          </span>
          <NavLink
            to="/yard/summary"
            className={({ isActive }) => cn('inline-flex h-12 items-center gap-2 rounded-full px-3 text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus', isActive ? 'bg-accent text-ink' : 'text-ink hover:bg-slate-100')}
          >
            <ChartNoAxesColumn aria-hidden className="size-5" />
            {t.summary}
          </NavLink>
          <Link to="/settings" aria-label={t.account} title={t.account} className={iconButton}>
            <UserRound aria-hidden className="size-6" />
          </Link>
          <button type="button" aria-label={strings.common.signOut} title={strings.common.signOut} onClick={() => void signOut()} className={iconButton}>
            <LogOut aria-hidden className="size-6" />
          </button>
        </div>
      </header>
      <RouteErrorBoundary variant="gate">
        <Outlet />
      </RouteErrorBoundary>
    </div>
  )
}
