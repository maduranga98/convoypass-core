import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { makePass, ts } from '@/test/passFactory'
import { AttentionPanel } from './AttentionPanel'
import { attentionItems } from './model'

const NOW = Date.UTC(2026, 2, 10, 6, 0)
const MIN = 60_000
const sla = { supervisorMinutes: 30, officerMinutes: 30 }
const pending = (id: string, minutes: number) => makePass({ id, plateNo: id, status: 'submitted', submittedAt: ts(NOW - minutes * MIN) })

const show = (passes = [pending('FRESH-1', 5), pending('OLD-1', 50), pending('OLDER-1', 120)], denied = 0, scope: 'admin' | 'officer' = 'admin') =>
  render(
    <MemoryRouter>
      <AttentionPanel items={attentionItems(passes, NOW, sla)} denied={denied} loading={false} scope={scope} today="20260310" contractorName={() => 'Alpha Haulage'} />
    </MemoryRouter>,
  )

describe('AttentionPanel', () => {
  it('lists only passes past their SLA, oldest first, with who holds them', () => {
    show()
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('OLDER-1'), expect.stringContaining('OLD-1')])
    expect(screen.queryByText('FRESH-1')).toBeNull()
    expect(rows[0]).toHaveTextContent('Supervisors of Alpha Haulage')
    expect(rows[0]).toHaveTextContent('2 h 0 min')
  })
  it('links an admin to the pass, and an officer only to passes that wait for them', () => {
    const { unmount } = show()
    expect(screen.getAllByRole('link', { name: /Open/ })[0]).toHaveAttribute('href', '/admin/passes?pass=OLDER-1')
    unmount()
    show(undefined, 0, 'officer')
    expect(screen.queryAllByRole('link', { name: /Open/ })).toHaveLength(0)
  })
  it('says nothing needs attention when nothing is late and nobody was denied', () => {
    show([pending('FRESH-1', 5)])
    expect(screen.getByText('Nothing needs attention')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
  it('shows denied entries today with a link to the gate log report', () => {
    show([pending('FRESH-1', 5)], 2)
    expect(screen.queryByText('Nothing needs attention')).toBeNull()
    expect(screen.getByText('2 entries denied today')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the gate log' })).toHaveAttribute('href', '/admin/reports?type=gate_log&from=2026-03-10&to=2026-03-10')
  })
})
