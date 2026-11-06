import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reportClientError = vi.hoisted(() => vi.fn<(payload: unknown) => Promise<{ ok: true }>>(async () => ({ ok: true })))
vi.mock('@/lib/api', () => ({ reportClientError }))

import { logClientError, resetClientErrorLogging } from '@/lib/clientErrors'
import { ErrorBoundary } from './ErrorBoundary'
import { RouteErrorBoundary } from './RouteErrorBoundary'

function Boom({ explode = true }: { explode?: boolean }): React.ReactElement {
  if (explode) throw new Error('kaboom for dan@example.com')
  return <p>fine</p>
}

beforeEach(() => {
  vi.clearAllMocks()
  resetClientErrorLogging()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.stubEnv('DEV', false)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('shows a friendly full-screen fallback with a Reload button and reports the crash', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload, pathname: '/driver' })
    render(
      <ErrorBoundary variant="app">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalled()
    expect(reportClientError).toHaveBeenCalledTimes(1)
    expect(reportClientError.mock.calls[0]?.[0]).toMatchObject({ source: 'boundary', route: '/driver' })
    vi.unstubAllGlobals()
  })

  it('the gate variant offers a way back to the gate; the form variant says answers are saved', () => {
    const { unmount } = render(<ErrorBoundary variant="gate"><Boom /></ErrorBoundary>)
    expect(screen.getByRole('link', { name: 'Back to gate' })).toHaveAttribute('href', '/security')
    expect(reportClientError.mock.calls[0]?.[0]).toMatchObject({ source: 'gate' })
    unmount()
    render(<ErrorBoundary variant="form"><Boom /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent(/saved on this device/i)
  })

  it('a route boundary clears when the person navigates away', () => {
    function Screen() {
      const { pathname } = useLocation()
      return pathname === '/a' ? <Boom /> : <p>other screen</p>
    }
    render(
      <MemoryRouter initialEntries={['/a']}>
        <Link to="/b">go</Link>
        <RouteErrorBoundary variant="form">
          <Screen />
        </RouteErrorBoundary>
      </MemoryRouter>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'go' }))
    expect(screen.getByText('other screen')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reporting is deduplicated and capped, and never throws', async () => {
    for (let i = 0; i < 3; i++) logClientError(new Error('same'), 'window')
    expect(reportClientError).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 10; i++) logClientError(new Error(`different ${i}`), 'window')
    expect(reportClientError).toHaveBeenCalledTimes(5)
    reportClientError.mockRejectedValueOnce(new Error('offline'))
    resetClientErrorLogging()
    expect(() => logClientError(new Error('x'), 'promise')).not.toThrow()
  })

  it('sends nothing from a development build', () => {
    vi.stubEnv('DEV', true)
    logClientError(new Error('dev'), 'window')
    expect(reportClientError).not.toHaveBeenCalled()
  })
})
