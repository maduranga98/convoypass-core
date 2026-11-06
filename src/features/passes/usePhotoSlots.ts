import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadEvidence } from './upload'

export type SlotKey = 'gps' | 'dashcam' | 'extra1' | 'extra2'

export interface Slot {
  status: 'uploading' | 'done' | 'error'
  /** 0..1 */
  progress: number
  previewUrl: string
  capturedAt: string
  method: 'live' | 'file'
  /** ms epoch of the last successful upload. */
  uploadedAt: number | null
}

export const RETRY_DELAYS_MS = [1000, 2000, 4000]

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
  })

interface Entry {
  blob: Blob
  controller: AbortController
  generation: number
}

/**
 * Photos upload in the background as soon as they are captured: progress, automatic retries with exponential
 * backoff, manual Retry, and everything is aborted on unmount. The blobs live in memory only.
 */
export function usePhotoSlots(pathFor: (key: SlotKey) => string) {
  const [slots, setSlots] = useState<Partial<Record<SlotKey, Slot>>>({})
  const entries = useRef(new Map<SlotKey, Entry>())
  const generation = useRef(0)
  const slotsRef = useRef(slots)
  useEffect(() => {
    slotsRef.current = slots
  }, [slots])
  const pathRef = useRef(pathFor)
  useEffect(() => {
    pathRef.current = pathFor
  })

  const patch = useCallback((key: SlotKey, gen: number, p: Partial<Slot>) => {
    if (entries.current.get(key)?.generation !== gen) return
    setSlots((s) => (s[key] ? { ...s, [key]: { ...s[key], ...p } } : s))
  }, [])

  /** Resolves true when the photo ended up uploaded. */
  const run = useCallback(
    async (key: SlotKey, entry: Entry): Promise<boolean> => {
      const { blob, controller, generation: gen } = entry
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        patch(key, gen, { status: 'uploading', progress: 0 })
        try {
          await uploadEvidence(pathRef.current(key), blob, (progress) => patch(key, gen, { progress }), controller.signal)
          patch(key, gen, { status: 'done', progress: 1, uploadedAt: Date.now() })
          return true
        } catch {
          if (controller.signal.aborted) return false
          const delay = RETRY_DELAYS_MS[attempt]
          if (delay === undefined) break
          await sleep(delay, controller.signal)
          if (controller.signal.aborted) return false
        }
      }
      patch(key, gen, { status: 'error' })
      return false
    },
    [patch],
  )

  const drop = (key: SlotKey) => {
    const old = entries.current.get(key)
    old?.controller.abort()
    entries.current.delete(key)
  }

  /** New or retaken photo: cancels any earlier upload of the same slot and starts uploading. */
  const capture = useCallback(
    (key: SlotKey, blob: Blob, meta: { method: 'live' | 'file'; capturedAt: string }) => {
      drop(key)
      const entry: Entry = { blob, controller: new AbortController(), generation: ++generation.current }
      entries.current.set(key, entry)
      const previous = slotsRef.current[key]
      if (previous) URL.revokeObjectURL(previous.previewUrl)
      const previewUrl = URL.createObjectURL(blob)
      setSlots((s) => ({ ...s, [key]: { status: 'uploading', progress: 0, previewUrl, uploadedAt: null, ...meta } }))
      void run(key, entry)
    },
    [run],
  )

  const retry = useCallback(
    (key: SlotKey) => {
      const old = entries.current.get(key)
      if (!old) return
      old.controller.abort()
      const entry: Entry = { blob: old.blob, controller: new AbortController(), generation: ++generation.current }
      entries.current.set(key, entry)
      void run(key, entry)
    },
    [run],
  )

  const remove = useCallback((key: SlotKey) => {
    drop(key)
    const previous = slotsRef.current[key]
    if (previous) URL.revokeObjectURL(previous.previewUrl)
    setSlots((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== key)))
  }, [])

  /**
   * Storage objects older than 30 minutes are refused by `submitPass`. A form left open for a while re-uploads the
   * affected photos (kept in memory) just before submitting. Resolves false when any upload fails.
   */
  const refreshStale = useCallback(
    async (maxAgeMs: number): Promise<boolean> => {
      const now = Date.now()
      const jobs: Promise<boolean>[] = []
      for (const [key, entry] of entries.current) {
        const slot = slotsRef.current[key]
        if (slot?.status === 'done' && slot.uploadedAt !== null && now - slot.uploadedAt > maxAgeMs) {
          const next: Entry = { blob: entry.blob, controller: new AbortController(), generation: ++generation.current }
          entries.current.set(key, next)
          jobs.push(run(key, next))
        }
      }
      return (await Promise.all(jobs)).every(Boolean)
    },
    [run],
  )

  useEffect(() => {
    const map = entries.current
    return () => {
      for (const e of map.values()) e.controller.abort()
      map.clear()
      for (const s of Object.values(slotsRef.current)) if (s) URL.revokeObjectURL(s.previewUrl)
    }
  }, [])

  return { slots, capture, retry, remove, refreshStale }
}
