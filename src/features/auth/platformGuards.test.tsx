import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@/lib/roles'

type Who = { kind: 'operator'; mustChange?: boolean } | { kind: 'tenant'; role: Role } | { kind: 'none' } | { kind: 'loading' }
let who: Who = { kind: 'none' }

vi.mock('./useAuth', () => ({
  useAuth: () => ({
    status: who.kind === 'loading' ? 'loading' : who.kind === 'none' ? 'signedOut' : 'signedIn',
    operator: who.kind === 'operator' ? { uid: 'op1', name: 'Olive', email: 'olive@convoypass.test', mustChangePassword: who.mustChange === true } : null,
    session: who.kind === 'tenant' ? { claims: { role: who.role, tenantId: 'T1' }, profile: { mustChangePassword: false } } : null,
  }),
}))
vi.mock('./ErrorPages', () => ({ ForbiddenPage: () => <p>403 Forbidden</p>, NotFoundPage: () => <p>404</p> }))

import { RequireAuth, RequireOperator, RequireRole, RoleHomeRedirect } from './guards'

const tree = (path: string) => (
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/" element={<RoleHomeRedirect />} />
      <Route path="/login" element={<p>login page</p>} />
      <Route path="/platform/login" element={<p>super admin sign-in</p>} />
      <Route element={<RequireOperator />}>
        <Route path="/platform/change-password" element={<p>change password page</p>} />
        <Route path="/platform/invites" element={<p>operator invites</p>} />
        <Route path="/platform/workspaces" element={<p>operator workspaces</p>} />
        <Route path="/platform/workspaces/:id" element={<p>operator workspace</p>} />
        <Route path="/platform" element={<p>operator overview</p>} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<RequireRole roles={['admin']} />}>
          <Route path="/admin/dashboard" element={<p>admin dashboard</p>} />
        </Route>
        <Route path="/settings" element={<p>settings</p>} />
        <Route path="/v/:id" element={<p>vehicle</p>} />
      </Route>
      <Route path="/admin" element={<p>admin home</p>} />
      <Route path="/platform-home" element={<p>x</p>} />
    </Routes>
  </MemoryRouter>
)

beforeEach(() => { who = { kind: 'none' } })

describe('/platform is operators only', () => {
  it('gives every workspace role a 403 on every /platform URL', () => {
    for (const role of ['admin', 'officer', 'supervisor', 'driver', 'security'] as const) {
      for (const path of ['/platform', '/platform/invites', '/platform/workspaces', '/platform/workspaces/ten_aaaaaaaaaa']) {
        who = { kind: 'tenant', role }
        const { unmount } = render(tree(path))
        expect(screen.getByText('403 Forbidden'), `${role} ${path}`).toBeInTheDocument()
        unmount()
      }
    }
  })
  it('lets an operator in, and sends a visitor to the Super admin sign-in (never the workspace login)', () => {
    who = { kind: 'operator' }
    const a = render(tree('/platform/invites'))
    expect(screen.getByText('operator invites')).toBeInTheDocument()
    a.unmount()
    who = { kind: 'none' }
    render(tree('/platform'))
    expect(screen.getByText('super admin sign-in')).toBeInTheDocument()
    expect(screen.queryByText('login page')).toBeNull()
  })
  it('holds an operator with a temporary password on the change page until it is changed', () => {
    who = { kind: 'operator', mustChange: true }
    const a = render(tree('/platform/workspaces'))
    expect(screen.getByText('change password page')).toBeInTheDocument()
    expect(screen.queryByText('operator workspaces')).toBeNull()
    a.unmount()
    render(tree('/platform'))
    expect(screen.getByText('change password page')).toBeInTheDocument()
    who = { kind: 'operator', mustChange: false }
    render(tree('/platform/change-password'))
    expect(screen.getAllByText('change password page').length).toBeGreaterThan(0)
  })
})

describe('operators get a 403 on every workspace route', () => {
  it('on role pages, /settings and /v/:id', () => {
    who = { kind: 'operator' }
    for (const path of ['/admin/dashboard', '/settings', '/v/veh_aaaaaaaaaa']) {
      const { unmount } = render(tree(path))
      expect(screen.getByText('403 Forbidden'), path).toBeInTheDocument()
      unmount()
    }
  })
  it('an admin still reaches the admin pages', () => {
    who = { kind: 'tenant', role: 'admin' }
    render(tree('/admin/dashboard'))
    expect(screen.getByText('admin dashboard')).toBeInTheDocument()
  })
})

describe('/ sends everyone home', () => {
  it('operator -> /platform, admin -> /admin, visitor -> /login, loading -> spinner (no redirect yet)', () => {
    who = { kind: 'operator' }
    let r = render(tree('/'))
    expect(screen.getByText('operator overview')).toBeInTheDocument()
    r.unmount()
    who = { kind: 'tenant', role: 'admin' }
    r = render(tree('/'))
    expect(screen.getByText('admin home')).toBeInTheDocument()
    r.unmount()
    who = { kind: 'none' }
    r = render(tree('/'))
    expect(screen.getByText('login page')).toBeInTheDocument()
    r.unmount()
    who = { kind: 'loading' }
    render(tree('/'))
    expect(screen.queryByText('login page')).toBeNull()
  })
})
