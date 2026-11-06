import { useCallback, useEffect, useState } from 'react'

export interface Position {
  lat: number
  lng: number
  accuracy: number
}

export type LocationState = { status: 'idle' | 'pending' | 'unavailable' } | { status: 'ok'; position: Position }

/**
 * One location fix per form: 4 s timeout, a fix up to 60 s old is fine. When location is required it asks for
 * permission straight away. When it is optional it never prompts: it only reads the location if the site already
 * has permission, and failure is silent.
 */
const supported = (): boolean => typeof navigator !== 'undefined' && Boolean(navigator.geolocation)

export function useLocation(required: boolean) {
  const [state, setState] = useState<LocationState>(() =>
    !supported() ? { status: 'unavailable' } : required ? { status: 'pending' } : { status: 'idle' },
  )

  const locate = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      (p) => setState({ status: 'ok', position: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }),
      () => setState({ status: 'unavailable' }),
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60_000 },
    )
  }, [])

  const retry = useCallback(() => {
    if (!supported()) return setState({ status: 'unavailable' })
    setState({ status: 'pending' })
    locate()
  }, [locate])

  useEffect(() => {
    if (!supported()) return
    if (required) {
      locate()
      return
    }
    let cancelled = false
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((r) => {
        if (!cancelled && r.state === 'granted') locate()
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [required, locate])

  return { state, retry }
}
