import { useEffect } from 'react'

/** The operator console is never indexed and never leaks its URL (same idea as /setup). Removed again on leaving. */
export function usePrivateMeta(): void {
  useEffect(() => {
    const added = [
      ['robots', 'noindex, nofollow'],
      ['referrer', 'no-referrer'],
    ].map(([name, content]) => {
      const m = document.createElement('meta')
      m.name = name as string
      m.content = content as string
      document.head.appendChild(m)
      return m
    })
    return () => added.forEach((m) => m.remove())
  }, [])
}
