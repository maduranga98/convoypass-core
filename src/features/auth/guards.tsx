import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { PageSpinner } from '@/components/ui/Spinner'
import { OPERATOR_HOME, ROLE_HOME, type Role } from '@/lib/roles'
import { ForbiddenPage } from './ErrorPages'
import { IdleGuard } from '@/features/platform/IdleGuard'
import { changePasswordUrl as operatorChangePasswordUrl, PLATFORM_CHANGE_PASSWORD, peekLoginReason, platformLoginUrl } from '@/features/platform/redirect'
import { isPinRole } from '@/lib/session'
import { changePasswordUrl, loginUrl } from './redirect'
import { useAuth } from './useAuth'

/**
 * Signed-out users go to /login (remembering where they were headed); must-change users go to /change-password.
 * A platform operator has no tenant, so every workspace route is a 403 for them (Module 9).
 */
export function RequireAuth() {
  const { status, session, operator } = useAuth()
  const location = useLocation()
  const here = location.pathname + location.search + location.hash

  if (status === 'loading') return <PageSpinner />
  if (operator) return <ForbiddenPage />
  if (!session) return <Navigate to={loginUrl(here)} replace />
  // PIN users (Module 12) have no password to change: the forced-change flow is for office staff only.
  if (session.profile.mustChangePassword && !isPinRole(session.claims.role) && location.pathname !== '/change-password') {
    return <Navigate to={changePasswordUrl(here)} replace />
  }
  return <Outlet />
}

/** UI-level gate only: Firestore rules and Cloud Functions enforce access independently. */
export function RequireRole({ roles }: { roles: readonly Role[] }) {
  const { session } = useAuth()
  if (!session || !roles.includes(session.claims.role)) return <ForbiddenPage />
  return <Outlet />
}

/**
 * `/` sends everyone home: workspace users to their role's home, operators to /platform, visitors to /login.
 * It sits outside `RequireAuth` (which refuses operators), so it handles the loading state itself.
 */
export function RoleHomeRedirect() {
  const { status, session, operator } = useAuth()
  if (status === 'loading') return <PageSpinner />
  if (operator) return <Navigate to={OPERATOR_HOME} replace />
  return <Navigate to={session ? ROLE_HOME[session.claims.role] : '/login'} replace />
}

/**
 * UI-level gate for /platform/* (except the public /platform/login): only a platform operator gets in; a workspace user
 * gets a 403 and a visitor goes to the Super admin sign-in page (never to the workspace login). An operator with a
 * temporary password is held on /platform/change-password until it is changed. The functions re-check everything
 * (claims, verified email, active operators doc) on every call. Operators also get the 30 minute idle timeout.
 */
export function RequireOperator() {
  const { status, operator, session } = useAuth()
  const location = useLocation()
  const here = location.pathname + location.search
  if (status === 'loading') return <PageSpinner />
  if (!operator && !session) return <Navigate to={platformLoginUrl(here, peekLoginReason())} replace />
  if (!operator) return <ForbiddenPage />
  if (operator.mustChangePassword && location.pathname !== PLATFORM_CHANGE_PASSWORD) {
    return <Navigate to={operatorChangePasswordUrl(here)} replace />
  }
  return (
    <>
      <IdleGuard />
      <Outlet />
    </>
  )
}
