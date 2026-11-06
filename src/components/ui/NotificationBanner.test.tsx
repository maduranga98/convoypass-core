import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NotificationBanner } from './NotificationBanner'

describe('NotificationBanner', () => {
  it('announces errors immediately and everything else politely', () => {
    const { rerender } = render(<NotificationBanner tone="error">Could not save</NotificationBanner>)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
    rerender(<NotificationBanner tone="success">Saved</NotificationBanner>)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('lets the caller pick the role, and shows a title, an action and a dismiss button', () => {
    const onDismiss = vi.fn()
    render(
      <NotificationBanner tone="warning" role="note" title="Heads up" action={<button type="button">Retry</button>} onDismiss={onDismiss}>
        Details
      </NotificationBanner>,
    )
    expect(screen.getByRole('note')).toHaveTextContent('Heads up')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
