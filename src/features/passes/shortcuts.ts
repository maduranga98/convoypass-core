import { useEffect, useEffectEvent } from 'react'

export type ShortcutAction = 'next' | 'previous' | 'approve' | 'reject' | 'close'

/** Typing in a field must never trigger a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** `J`/`K` next and previous, `A` approve, `R` reject, `Esc` close. Null for anything else, or while typing. */
export function shortcutFor(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (isTypingTarget(e.target)) return null
  switch (e.key) {
    case 'j': case 'J': return 'next'
    case 'k': case 'K': return 'previous'
    case 'a': case 'A': return 'approve'
    case 'r': case 'R': return 'reject'
    case 'Escape': return 'close'
    default: return null
  }
}

/** Window-level shortcuts; `handlers` may change on every render without re-subscribing. */
export function useReviewShortcuts(enabled: boolean, handlers: Partial<Record<ShortcutAction, () => void>>): void {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat) return
    const action = shortcutFor(e)
    const fn = action ? handlers[action] : undefined
    if (fn) {
      e.preventDefault()
      fn()
    }
  })
  useEffect(() => {
    if (!enabled) return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
