import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { useSession } from '@/features/auth/useAuth'
import { can } from '@/lib/permissions'
import { ROLE_HOME } from '@/lib/roles'
import { visitorStrings } from '@/lib/visitorStrings'
import { useEffect } from 'react'
import { useNow } from '@/features/passes/useToday'
import { useVisitorLookup } from './useVisitorLookup'
import { VisitorPassCard } from './VisitorPassCard'

/**
 * `/vp/:code` (behind the login redirect), the address in a visitor pass QR. Security gets the card with Check in / Check out;
 * the admin, supervisors and the Safety Officer the same facts read only. Everyone else is sent to the 403 page.
 */
export default function VisitorPassRoute() {
  const { code = '' } = useParams()
  const { claims } = useSession()
  const navigate = useNavigate()
  const now = useNow(30_000)
  const { lookup, find } = useVisitorLookup()
  const allowed = can(claims.role, 'visitorPass.lookup')

  useEffect(() => {
    if (allowed) void find({ code })
  }, [allowed, code, find])

  if (!allowed) return <Navigate to="/403" replace />
  const home = ROLE_HOME[claims.role]
  const back = () => void navigate(claims.role === 'security' ? '/security?mode=visitor' : home)

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      {lookup.state === 'found' ? (
        <VisitorPassCard view={lookup.view} readOnly={claims.role !== 'security'} now={now} onNext={back} />
      ) : lookup.state === 'notFound' ? (
        <NotificationBanner tone="error" title={visitorStrings.gate.state.notFound} size="lg">
          {visitorStrings.gate.reason.notFound}
        </NotificationBanner>
      ) : lookup.state === 'error' ? (
        <NotificationBanner tone="error" title={visitorStrings.gate.loadFailed} size="lg">
          {lookup.message}
        </NotificationBanner>
      ) : (
        <ListSkeleton rows={3} />
      )}
      {lookup.state !== 'found' && lookup.state !== 'idle' && lookup.state !== 'loading' && (
        <Link to={claims.role === 'security' ? '/security?mode=visitor' : home} className="inline-flex h-14 items-center text-lg font-bold text-ink underline underline-offset-2">
          {visitorStrings.page.back}
        </Link>
      )}
    </div>
  )
}
