import { Camera, ImageUp, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useUpdateLock } from '@/pwa/updateLock'
import { strings } from '@/lib/strings'
import { encodeAndCompress, processFile, renderStamped } from './capture'

const t = strings.pass.camera

export interface CaptureResult {
  blob: Blob
  method: 'live' | 'file'
  /** ISO time on the device clock. Informational only: the server never trusts it. */
  capturedAt: string
}

interface Props {
  /** What is being photographed, shown in the top bar. */
  label: string
  /** Burned into the photo. */
  plateNo: string
  onCapture: (result: CaptureResult) => void
  onClose: () => void
}

const hasCamera = (): boolean => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

const stop = (stream: MediaStream | null) => stream?.getTracks().forEach((track) => track.stop())

/**
 * Full-screen camera. Live capture where `getUserMedia` works; otherwise (unsupported, or permission denied) a file
 * input that opens the native camera. Either way the photo is stamped, capped at 1600 px and compressed.
 */
export function CameraCapture({ label, plateNo, onCapture, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [mode, setMode] = useState<'starting' | 'live' | 'fallback'>(() => (hasCamera() ? 'starting' : 'fallback'))
  const [reason, setReason] = useState<'unsupported' | 'denied'>(() => (hasCamera() ? 'denied' : 'unsupported'))
  const [busy, setBusy] = useState(false)
  // The shutter works once the first frame is there (before that there is nothing to capture).
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // An app update must not reload the page while the camera is open.
  useUpdateLock()

  // The page behind must not scroll while the overlay is open.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Start the camera; always release it on unmount.
  useEffect(() => {
    if (mode !== 'starting') return
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (cancelled) return stop(s)
        stream.current = s
        // Another app taking the camera ends the track: fall back instead of freezing on the last frame.
        s.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (!cancelled) {
            setReason('denied')
            setMode('fallback')
          }
        })
        const el = video.current
        if (el) {
          // iOS Safari: inline playback needs the property and the attribute, and an explicit play().
          el.muted = true
          el.setAttribute('playsinline', 'true')
          el.srcObject = s
          void el.play().catch(() => undefined)
        }
        setMode('live')
      })
      .catch(() => {
        if (cancelled) return
        setReason('denied')
        setMode('fallback')
      })
    return () => {
      cancelled = true
    }
  }, [mode])
  useEffect(
    () => () => {
      stop(stream.current)
      stream.current = null
    },
    [],
  )

  const finish = useCallback(
    async (make: () => Promise<Blob>, method: CaptureResult['method']) => {
      setBusy(true)
      setError(null)
      try {
        const capturedAt = new Date().toISOString()
        onCapture({ blob: await make(), method, capturedAt })
      } catch {
        setError(t.failed)
        setBusy(false)
      }
    },
    [onCapture],
  )

  const captureFrame = () => {
    const el = video.current
    if (!el || el.videoWidth === 0 || busy) return
    // Grab the frame first, then release the camera, then encode.
    let canvas: HTMLCanvasElement
    try {
      canvas = renderStamped(el, el.videoWidth, el.videoHeight, plateNo, new Date())
    } catch {
      setError(t.failed)
      return
    }
    stop(stream.current)
    stream.current = null
    void finish(() => encodeAndCompress(canvas), 'live')
  }

  const pickFile = (file: File | undefined) => {
    if (!file) return
    stop(stream.current)
    stream.current = null
    void finish(() => processFile(file, plateNo), 'file')
    if (fileInput.current) fileInput.current.value = ''
  }

  const fileField = (
    <input
      ref={fileInput}
      type="file"
      accept="image/*"
      capture="environment"
      className="sr-only"
      tabIndex={-1}
      aria-label={t.chooseFile}
      onChange={(e) => pickFile(e.target.files?.[0])}
    />
  )

  return (
    <div role="dialog" aria-modal="true" aria-label={t.title(label)} className="fixed inset-0 z-50 flex flex-col bg-scrim text-on-solid">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <p className="truncate text-base font-semibold">{label}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="grid size-12 place-items-center rounded-full hover:bg-on-solid/10 focus-visible:outline-2 focus-visible:outline-on-solid"
        >
          <X aria-hidden className="size-6" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          aria-hidden
          onLoadedData={() => setReady(true)}
          className={mode === 'live' ? 'absolute inset-0 size-full object-cover' : 'pointer-events-none absolute size-px opacity-0'}
        />

        {mode === 'starting' && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="flex items-center gap-2 text-sm">
              <Spinner className="text-on-solid" /> {t.starting}
            </p>
          </div>
        )}

        {mode === 'fallback' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8 text-center">
            <Camera aria-hidden className="size-12 text-on-solid/60" />
            <p role="status" className="max-w-xs text-base">{reason === 'denied' ? t.denied : t.unsupported}</p>
            <Button className="h-14 min-w-56 bg-surface px-6 text-base text-scrim hover:bg-slate-200" icon={<ImageUp aria-hidden className="size-5" />} loading={busy} onClick={() => fileInput.current?.click()}>
              {t.chooseFile}
            </Button>
          </div>
        )}

        {busy && mode !== 'fallback' && (
          <div className="absolute inset-0 grid place-items-center bg-scrim/60">
            <p className="flex items-center gap-2 text-sm"><Spinner className="text-on-solid" /> {t.processing}</p>
          </div>
        )}

        {error && (
          <p role="alert" className="absolute inset-x-4 top-2 rounded-lg bg-danger px-3 py-2 text-center text-sm font-medium">
            {error}
          </p>
        )}
      </div>

      {mode === 'live' && (
        <div className="flex h-28 shrink-0 items-center justify-center gap-8 pb-[env(safe-area-inset-bottom)]">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            aria-label={t.chooseFile}
            className="grid size-12 place-items-center rounded-full bg-on-solid/10 hover:bg-on-solid/20 focus-visible:outline-2 focus-visible:outline-on-solid"
          >
            <ImageUp aria-hidden className="size-6" />
          </button>
          <button
            type="button"
            onClick={captureFrame}
            disabled={busy || !ready}
            aria-label={t.capture}
            className="grid size-20 place-items-center rounded-full border-4 border-on-solid bg-on-solid/20 active:bg-on-solid/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-on-solid disabled:opacity-50"
          >
            <span className="size-14 rounded-full bg-surface" />
          </button>
          <span className="size-12" aria-hidden />
        </div>
      )}
      {fileField}
    </div>
  )
}
