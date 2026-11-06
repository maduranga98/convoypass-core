import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@/lib/roles'

let role: Role = 'supervisor'
vi.mock('./useAuth', () => ({ useAuth: () => ({ status: 'ready', session: { claims: { role, tenantId: 'T1' }, profile: { mustChangePassword: false } } }) }))
vi.mock('./ErrorPages', () => ({ ForbiddenPage: () => <p>403 Forbidden</p>, NotFoundPage: () => <p>404</p> }))

import { RequireRole } from './guards'

const tree = (path: string) => (
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route element={<RequireRole roles={['admin']} />}>
        <Route path="/admin/dashboard" element={<p>admin dashboard</p>} />
        <Route path="/admin/reports" element={<p>admin reports</p>} />
      </Route>
      <Route element={<RequireRole roles={['officer']} />}>
        <Route path="/officer/overview" element={<p>officer overview</p>} />
        <Route path="/officer/reports" element={<p>officer reports</p>} />
      </Route>
    </Routes>
  </MemoryRouter>
)

beforeEach(() => {
  role = 'supervisor'
})

describe('dashboard and report routes', () => {
  it('give supervisors, drivers and security a 403 on every dashboard and report URL', () => {
    for (const r of ['supervisor', 'driver', 'security'] as const) {
      for (const path of ['/admin/dashboard', '/admin/reports', '/officer/overview', '/officer/reports']) {
        role = r
        const { unmount } = render(tree(path))
        expect(screen.getByText('403 Forbidden')).toBeInTheDocument()
        unmount()
      }
    }
  })
  it('lets admin into admin pages only and officer into officer pages only', () => {
    role = 'admin'
    const a = render(tree('/admin/reports'))
    expect(screen.getByText('admin reports')).toBeInTheDocument()
    a.unmount()
    render(tree('/officer/reports'))
    expect(screen.getByText('403 Forbidden')).toBeInTheDocument()
  })
})
