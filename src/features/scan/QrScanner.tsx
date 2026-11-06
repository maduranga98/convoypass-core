import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { Camera, CameraOff, Flashlight, FlashlightOff, ScanLine, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { appBase } from '@/lib/appUrl'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { parseVehicleQr } from '@/lib/vehicleQr'

const t = strings.scanner

/** Set once the first-use explainer was accepted on this phone. */
const EXPLAINED_KEY = 'cp_scan_explained'
const explained = (): boolean => {
  try {
    return localStorage.getItem(EXPLAINED_KEY) === '1'
  } catch {
    return false
  }
}
const rememberExplained = (): void => {
  try {
    localStorage.setItem(EXPLAINED_KEY, '1')
  } catch {
    /* storage blocked: the explainer shows again next time */
  }
}
const isIos = (): boolean => /iPhone|iPad|iPod/i.test(navigator.userAgent)

/** The same code read again within this window is ignored (the camera sees it many times a second). */
const REPEAT_MS = 2500
const MESSAGE_MS = 3000

type Phase = 'explain' | 'starting' | 'scanning' | 'denied' | 'nocamera' | 'failed' | 'insecure'

function classify(e: unknown): Phase {
  const text = `${(e as { name?: unknown } | null)?.name ?? ''} ${String(e)}`
  if (/NotAllowed|Permission|denied/i.test(text)) return 'denied'
  if (/NotFound|Requested device not found|no camera|Overconstrained/i.test(text)) return 'nocamera'
  return 'failed'
}

/** Stops every camera track under `el`, whatever state the library is in. */
function stopTracks(el: HTMLElement | null): void {
  el?.querySelectorAll('video').forEach((video) => {
    const stream = video.srcObject
    if (stream && typeof (stream as MediaStream).getTracks === 'function') (stream as MediaStream).getTracks().forEach((track) => track.stop())
    video.srcObject = null
  })
}

/**
 * Full-screen in-app scanner (html5-qrcode), back camera preferred. Shared by drivers and security (Module 12): on first
 * use it explains the camera prompt in one line; a blocked camera shows short steps for Android and iPhone. Every read goes through `parseVehicleQr`;
 * anything that is not ours shows "Not a ConvoyPass QR code" and scanning continues. On a valid code the camera is
 * stopped first, then `onVehicle` is called. All tracks are stopped on unmount.
 */
export function QrScanner({ onVehicle, onClose }: { onVehicle: (vehicleId: string) => void; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onVehicleRef = useRef(onVehicle)
  // The camera API exists only in secure contexts (https or localhost).
  const [phase, setPhase] = useState<Phase>(() =>
    !(window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function') ? 'insecure' : explained() ? 'starting' : 'explain',
  )
  const insecure = phase === 'insecure'
  // The camera starts only after the explainer (first use on this phone) was accepted.
  const waiting = phase === 'explain'
  const [message, setMessage] = useState<string | null>(null)
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false })
  const torchRef = useRef<{ apply: (on: boolean) => Promise<void> } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    onVehicleRef.current = onVehicle
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const host = hostRef.current
    if (!host || insecure || waiting) return
    // A fresh element per run, so a quick unmount/remount (StrictMode, retry) never shares one with a stopping scanner.
    const el = document.createElement('div')
    el.id = `qr-${Math.random().toString(36).slice(2)}`
    el.className = 'w-full'
    host.appendChild(el)

    let disposed = false
    let done = false
    let last = { text: '', at: 0 }
    let clearMsg: ReturnType<typeof setTimeout> | undefined
    const scanner = new Html5Qrcode(el.id, { verbose: false, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] })

    const stop = async () => {
      try {
        if (scanner.isScanning) await scanner.stop()
      } catch {
        // already stopped
      }
      stopTracks(el)
      try {
        scanner.clear()
      } catch {
        // nothing rendered
      }
    }

    const onRead = (text: string) => {
      const now = Date.now()
      if (done || (text === last.text && now - last.at < REPEAT_MS)) return
      last = { text, at: now }
      const vehicleId = parseVehicleQr(text, appBase?.url ?? window.location.origin)
      if (!vehicleId) {
        setMessage(t.notOurs)
        clearTimeout(clearMsg)
        clearMsg = setTimeout(() => setMessage(null), MESSAGE_MS)
        return
      }
      done = true
      void stop().then(() => onVehicleRef.current(vehicleId))
    }

    const started = scanner
      .start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (w: number, h: number) => {
            const side = Math.max(160, Math.floor(Math.min(w, h) * 0.7))
            return { width: side, height: side }
          },
        },
        onRead,
        () => undefined, // "no code in this frame": not an error
      )
      .then(() => {
        if (disposed) return
        setPhase('scanning')
        try {
          const cap = scanner.getRunningTrackCameraCapabilities().torchFeature()
          if (cap.isSupported()) {
            torchRef.current = cap
            setTorch({ supported: true, on: false })
          }
        } catch {
          // no torch information
        }
      })
      .catch((e: unknown) => {
        if (!disposed) setPhase(classify(e))
      })

    return () => {
      disposed = true
      clearTimeout(clearMsg)
      torchRef.current = null
      // Stop once start has settled (stopping a scanner that is still starting throws), then drop the element.
      void started.finally(() => stop().finally(() => el.remove()))
      stopTracks(el)
    }
  }, [attempt, insecure, waiting])

  const toggleTorch = async () => {
    const cap = torchRef.current
    if (!cap) return
    try {
      await cap.apply(!torch.on)
      setTorch((s) => ({ ...s, on: !s.on }))
    } catch {
      setTorch({ supported: false, on: false })
    }
  }

  const problem =
    phase === 'denied' ? { title: t.deniedTitle, body: t.deniedIntro }
    : phase === 'nocamera' ? { title: t.deniedTitle, body: t.noCamera }
    : phase === 'insecure' ? { title: t.deniedTitle, body: t.insecure }
    : phase === 'failed' ? { title: t.deniedTitle, body: t.failed }
    : null
  const ios = isIos()
  const steps = ios ? { title: t.iphoneTitle, items: t.iphoneSteps } : { title: t.androidTitle, items: t.androidSteps }

  return (
    <div role="dialog" aria-modal="true" aria-label={t.title} className="fixed inset-0 z-50 flex flex-col bg-scrim text-on-solid">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-3">
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="inline-flex size-12 items-center justify-center rounded-full bg-on-solid/15 focus-visible:outline-2 focus-visible:outline-on-solid"
        >
          <X aria-hidden className="size-7" />
        </button>
        <p className="text-lg font-bold">{t.title}</p>
        {torch.supported ? (
          <button
            type="button"
            onClick={() => void toggleTorch()}
            aria-pressed={torch.on}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-on-solid/15 px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-on-solid"
          >
            {torch.on ? <FlashlightOff aria-hidden className="size-5" /> : <Flashlight aria-hidden className="size-5" />}
            {torch.on ? t.torchOff : t.torchOn}
          </button>
        ) : (
          <span className="size-12" />
        )}
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <div ref={hostRef} className={cn('w-full max-w-lg', (problem || waiting) && 'hidden')} />
        {waiting && (
          <div className="mx-6 max-w-sm space-y-4 rounded-2xl bg-surface p-6 text-center text-ink">
            <Camera aria-hidden className="mx-auto size-12" />
            <p className="text-xl font-extrabold">{t.explainTitle}</p>
            <p className="text-lg">{t.explainBody}</p>
            <button
              type="button"
              onClick={() => {
                rememberExplained()
                setPhase('starting')
              }}
              className="h-14 w-full rounded-xl bg-brand text-lg font-bold text-on-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {t.explainGo}
            </button>
          </div>
        )}
        {phase === 'starting' && (
          <p role="status" className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-lg font-semibold">{t.starting}</p>
        )}
        {problem && (
          <div role="alert" className="mx-6 max-w-sm space-y-4 rounded-2xl bg-surface p-6 text-center text-ink">
            <CameraOff aria-hidden className="mx-auto size-12 text-danger-strong" />
            <p className="text-xl font-extrabold">{problem.title}</p>
            <p className="text-lg">{problem.body}</p>
            {phase === 'denied' && (
              <div className="text-left">
                <p className="font-bold">{steps.title}</p>
                <ol className="mt-1 list-decimal space-y-1 pl-6 text-base">
                  {steps.items.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {phase !== 'insecure' && phase !== 'nocamera' && (
                <button
                  type="button"
                  onClick={() => {
                    setPhase('starting')
                    setAttempt((n) => n + 1)
                  }}
                  className="h-14 rounded-xl bg-brand text-lg font-bold text-on-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  {t.retry}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="h-14 rounded-xl border-2 border-slate-300 text-lg font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {t.close}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {message ? (
          <p role="alert" className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-danger-strong px-4 text-lg font-extrabold">
            <TriangleAlert aria-hidden className="size-6 shrink-0" />
            {message}
          </p>
        ) : (
          <p className="flex min-h-14 items-center justify-center gap-2 text-center text-base font-semibold text-on-solid/90">
            <ScanLine aria-hidden className="size-6 shrink-0" />
            {t.hint}
          </p>
        )}
      </div>
    </div>
  )
}
