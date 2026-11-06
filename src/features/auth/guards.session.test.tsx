// Module 12: a signed-out (or expired) visitor goes to the PIN screen with the return URL kept.
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./useAuth', () => ({ useAuth: () => ({ status: 'signedOut', session: null, operator: null }) }))
vi.mock('@/features/platform/IdleGuard', () => ({ IdleGuard: () => null }))

import { RequireAuth } from './guards'

const Where = () => {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}
const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/v/:id" element={<p>vehicle</p>} />
          <Route path="/security" element={<p>gate</p>} />
          <Route path="/admin/users" element={<p>users</p>} />
        </Route>
        <Route path="/login" element={<Where />} />
        <Route path="/login/staff" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )

describe('RequireAuth after a session ends', () => {
  it('a scanned vehicle link asks for the PIN first and keeps the vehicle as the return URL', () => {
    at('/v/veh_abcdefghij')
    expect(screen.getByTestId('where')).toHaveTextContent('/login?next=%2Fv%2Fveh_abcdefghij')
  })
  it('the security home returns to itself; office-staff areas go to the email form', () => {
    const a = at('/security')
    expect(screen.getByTestId('where')).toHaveTextContent('/login?next=%2Fsecurity')
    a.unmount()
    at('/admin/users')
    expect(screen.getByTestId('where')).toHaveTextContent('/login/staff?next=%2Fadmin%2Fusers')
  })
})
