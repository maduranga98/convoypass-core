import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REJECTION_REASONS } from '@/lib/defaultRejectionReasons'
import { RejectSheet } from './RejectSheet'

// jsdom has no <dialog> modal support.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

const setup = (props: Partial<React.ComponentProps<typeof RejectSheet>> = {}) => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<RejectSheet open reasons={DEFAULT_REJECTION_REASONS} onConfirm={onConfirm} onCancel={onCancel} {...props} />)
  return { onConfirm, onCancel, user: userEvent.setup() }
}
const reason = (label: RegExp) => screen.getByRole('radio', { name: label })
const confirmBtn = () => screen.getByRole('button', { name: /^reject pass$/i })

describe('RejectSheet', () => {
  it('lists the reasons as a single-select group', async () => {
    const { user } = setup()
    expect(screen.getAllByRole('radio')).toHaveLength(DEFAULT_REJECTION_REASONS.length)
    await user.click(reason(/gps photo unclear/i))
    await user.click(reason(/dashcam photo unclear/i))
    expect(reason(/gps photo unclear/i)).not.toBeChecked()
    expect(reason(/dashcam photo unclear/i)).toBeChecked()
  })

  it('needs a reason before it confirms', async () => {
    const { user, onConfirm } = setup()
    await user.click(confirmBtn())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/choose a reason/i)
  })

  it('confirms with just a code for an ordinary reason, note optional', async () => {
    const { user, onConfirm } = setup()
    await user.click(reason(/photos do not match/i))
    await user.click(confirmBtn())
    expect(onConfirm).toHaveBeenCalledWith({ reasonCode: 'wrong_vehicle' })
  })

  it('requires a note for "other" and sends it trimmed', async () => {
    const { user, onConfirm } = setup()
    await user.click(reason(/other/i))
    expect(screen.getByLabelText(/note \(required/i)).toBeInTheDocument()
    await user.click(confirmBtn())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/short note/i)
    await user.type(screen.getByLabelText(/note \(required/i), ' a ')
    await user.click(confirmBtn())
    expect(onConfirm).not.toHaveBeenCalled() // one letter is not a note
    await user.type(screen.getByLabelText(/note \(required/i), 'bc  ')
    await user.click(confirmBtn())
    expect(onConfirm).toHaveBeenCalledWith({ reasonCode: 'other', note: 'a bc' })
  })

  it('shows the error from the last attempt and locks the form while loading', async () => {
    const { user } = setup({ error: 'This pass changed. Please review it again.', loading: true })
    expect(screen.getByText(/this pass changed/i)).toBeInTheDocument()
    expect(reason(/gps photo unclear/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /reject pass/i }))
  })

  it('uses revoke wording in revoke mode and starts empty each time it opens', async () => {
    const { user, onConfirm } = setup({ mode: 'revoke' })
    expect(screen.getByRole('heading', { name: /revoke this approval/i })).toBeInTheDocument()
    await user.click(reason(/old or reused/i))
    await user.click(screen.getByRole('button', { name: /revoke approval/i }))
    expect(onConfirm).toHaveBeenCalledWith({ reasonCode: 'photo_not_fresh' })
  })
})
