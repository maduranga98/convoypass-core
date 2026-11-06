import { useCallback, useEffect, useState } from 'react'

/** Counts down whole seconds after `start()`. `remaining` is 0 when the action may be repeated. */
export function useCooldown(seconds: number): { remaining: number; start: () => void } {
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const id = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= until) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [until])
  const start = useCallback(() => {
    setNow(Date.now())
    setUntil(Date.now() + seconds * 1000)
  }, [seconds])
  return { remaining: Math.max(0, Math.ceil((until - now) / 1000)), start }
}
