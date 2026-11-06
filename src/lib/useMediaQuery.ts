import { useCallback, useSyncExternalStore } from 'react'

/** Live `matchMedia` result. False where matchMedia does not exist (tests, old browsers). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined
      if (!list) return () => undefined
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  const get = () => (typeof window !== 'undefined' ? (window.matchMedia?.(query).matches ?? false) : false)
  return useSyncExternalStore(subscribe, get, () => false)
}
