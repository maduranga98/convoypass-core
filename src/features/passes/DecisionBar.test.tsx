import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DecisionBar } from './DecisionBar'

describe('DecisionBar', () => {
  it('approves and rejects', async () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    render(<DecisionBar busy={null} onApprove={onApprove} onReject={onReject} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /approve/i }))
    await new Promise((r) => requestAnimationFrame(r)) // the double-tap guard releases on the next frame
    await user.click(screen.getByRole('button', { name: /reject/i }))
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledTimes(1)
  })
  it('a double click only fires once', async () => {
    const onApprove = vi.fn()
    render(<DecisionBar busy={null} onApprove={onApprove} onReject={vi.fn()} />)
    await userEvent.setup().dblClick(screen.getByRole('button', { name: /approve/i }))
    expect(onApprove).toHaveBeenCalledTimes(1)
  })
  it('locks both buttons while a decision is in flight and when disabled', () => {
    const { rerender } = render(<DecisionBar busy="approve" onApprove={vi.fn()} onReject={vi.fn()} />)
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
    rerender(<DecisionBar busy={null} disabled onApprove={vi.fn()} onReject={vi.fn()} />)
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
  })
})
