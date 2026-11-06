import { useEffect, type ReactNode } from 'react'
import { useLocation, useRouteError } from 'react-router-dom'
import { useAuth } from '@/features/auth/useAuth'
import { logClientError } from '@/lib/clientErrors'
import { ErrorBoundary, ErrorFallback, type BoundaryVariant } from './ErrorBoundary'

/**
 * The router's `errorElement`. React Router catches render errors inside its routes before the app's
 * `ErrorBoundary` sees them, and its own fallback is a developer screen; this shows ours instead.
 */
export function RouteErrorPage() {
  const error = useRouteError()
  useEffect(() => {
    logClientError(error, 'boundary')
  }, [error])
  return <ErrorFallback />
}

/** A boundary that resets when the route changes, so navigating away from a crashed screen works. */
export function RouteErrorBoundary({ variant, children }: { variant: BoundaryVariant; children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary key={pathname} variant={variant}>
      {children}
    </ErrorBoundary>
  )
}

/** The shared vehicle screen (`/v/:vehicleId`): the gate view for security, the pre-trip form for everyone else. */
export function VehicleRouteBoundary({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  return <RouteErrorBoundary variant={session?.claims.role === 'security' ? 'gate' : 'form'}>{children}</RouteErrorBoundary>
}
