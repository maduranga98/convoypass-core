import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { makePass, no, TODAY } from '@/test/passFactory'

vi.mock('@/lib/firebase', () => ({ app: {} }))
vi.mock('firebase/storage', () => ({ getStorage: () => ({}), ref: (_s: unknown, p: string) => p, getDownloadURL: async (p: string) => `https://photos.test/${p}` }))

import { PassRow } from './PassRow'

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ul>{ui}</ul>
      </MemoryRouter>
    </QueryClientProvider>,
  )

describe('PassRow', () => {
  it('shows the plate, vehicle, driver and wait, and links to the review', () => {
    wrap(<PassRow pass={makePass({ id: 'p1' })} now={Date.now()} today={TODAY} to="/supervisor/approvals/p1" />)
    expect(screen.getByText('WP LJ-4821')).toBeTruthy()
    expect(screen.getByText(/Tipper · Sunil Rathnayake/)).toBeTruthy()
    expect(screen.getByText('5 min ago')).toBeTruthy()
    expect(screen.queryByText(/issue/i)).toBeNull()
    expect(screen.getByRole('link').getAttribute('href')).toBe('/supervisor/approvals/p1')
  })
  it('marks issues and an overdue wait', () => {
    wrap(<PassRow pass={makePass({ checklist: [no('a'), no('b')] })} now={Date.now()} today={TODAY} to="/x" overdue />)
    expect(screen.getByText('2 issues')).toBeTruthy()
    expect(screen.getByText(/Overdue/)).toBeTruthy()
  })
  it('select mode: a clean row toggles, a row with issues has no checkbox and still opens', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    const { unmount } = wrap(<PassRow pass={makePass()} now={Date.now()} today={TODAY} to="/x" selecting selectable onToggle={onToggle} />)
    await user.click(screen.getByRole('checkbox', { name: /select wp lj-4821/i }))
    await user.click(screen.getByText('WP LJ-4821'))
    expect(onToggle).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('link')).toBeNull()
    unmount()

    wrap(<PassRow pass={makePass({ checklist: [no('a')] })} now={Date.now()} today={TODAY} to="/x" selecting selectable={false} onToggle={onToggle} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('link')).toBeTruthy()
  })
})
