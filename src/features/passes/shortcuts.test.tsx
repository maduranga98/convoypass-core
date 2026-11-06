import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { isTypingTarget, shortcutFor, useReviewShortcuts } from './shortcuts'

const key = (k: string, target: EventTarget | null = document.body, mods: Partial<KeyboardEvent> = {}) =>
  shortcutFor({ key: k, ctrlKey: false, metaKey: false, altKey: false, target, ...mods })

describe('shortcutFor', () => {
  it('maps J K A R and Esc', () => {
    expect([key('j'), key('K'), key('a'), key('R'), key('Escape')]).toEqual(['next', 'previous', 'approve', 'reject', 'close'])
    expect(key('x')).toBeNull()
  })
  it('ignores modified keys (Ctrl+R reloads the page, not a rejection)', () => {
    expect(key('r', document.body, { ctrlKey: true })).toBeNull()
    expect(key('a', document.body, { metaKey: true })).toBeNull()
  })
  it('is ignored while typing in a field', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(key('a', document.createElement(tag))).toBeNull()
    }
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(isTypingTarget(editable)).toBe(true)
    expect(key('r', editable)).toBeNull()
  })
})

function Harness({ onApprove, onReject }: { onApprove: () => void; onReject: () => void }) {
  useReviewShortcuts(true, { approve: onApprove, reject: onReject })
  return <textarea aria-label="note" />
}

describe('useReviewShortcuts', () => {
  it('fires on the page but not while a text field has focus', async () => {
    const approve = vi.fn()
    const reject = vi.fn()
    render(<Harness onApprove={approve} onReject={reject} />)
    const user = userEvent.setup()
    await user.keyboard('a')
    expect(approve).toHaveBeenCalledTimes(1)
    await user.click(screen.getByLabelText('note'))
    await user.keyboard('arar')
    expect(approve).toHaveBeenCalledTimes(1)
    expect(reject).not.toHaveBeenCalled()
    expect(screen.getByLabelText('note')).toHaveValue('arar')
  })
  it('does nothing when disabled', async () => {
    const approve = vi.fn()
    function Off() {
      useReviewShortcuts(false, { approve })
      return null
    }
    render(<Off />)
    await userEvent.setup().keyboard('a')
    expect(approve).not.toHaveBeenCalled()
  })
})
