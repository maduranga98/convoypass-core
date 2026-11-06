import { ChevronLeft, ChevronRight, ScanText, X, ZoomIn } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import type { EvidenceItem } from './passView'
import { useEvidenceUrl } from './useEvidenceUrl'

const t = strings.approvals.evidence

const MAX_SCALE = 5
const TAP_ZOOM = 2.5
const STAMP_ZOOM = 3
const SWIPE_PX = 60
const TAP_MS = 300
const TAP_SLOP_PX = 10

interface View {
  scale: number
  x: number
  y: number
}
const RESET: View = { scale: 1, x: 0, y: 0 }

interface Props {
  items: readonly EvidenceItem[]
  index: number
  plateNo: string
  onIndexChange: (index: number) => void
  onClose: () => void
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Full-screen photo viewer. Arrow keys or a swipe move between photos, Esc closes, a tap (touch) or double-click
 * (mouse) toggles zoom, two fingers pinch. "Zoom to stamp" jumps to the bottom-left corner where the plate and the
 * capture time are printed.
 */
export function EvidenceViewer({ items, index, plateNo, onIndexChange, onClose }: Props) {
  const item = items[index]
  const url = useEvidenceUrl(item?.path)
  const [view, setView] = useState<View>(RESET)
  const imgRef = useRef<HTMLImageElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef({ startDist: 0, startScale: 1, startX: 0, startY: 0, startView: RESET, moved: false, downAt: 0 })
  const viewRef = useRef(view)
  const [gesturing, setGesturing] = useState(false)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  const go = useCallback(
    (by: -1 | 1) => {
      const next = index + by
      if (next >= 0 && next < items.length) {
        setView(RESET)
        onIndexChange(next)
      }
    },
    [index, items.length, onIndexChange],
  )

  // Keyboard: Esc, arrows, and Tab kept inside the viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'Tab' && rootRef.current) {
        const focusable = [...rootRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')]
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!first || !last) return
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose])

  // Focus the close button on open and give focus back to whatever opened the viewer.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      opener?.focus?.()
    }
  }, [])

  const clamp = (v: View): View => {
    const img = imgRef.current
    if (!img || v.scale <= 1) return RESET
    const maxX = ((v.scale - 1) * img.offsetWidth) / 2
    const maxY = ((v.scale - 1) * img.offsetHeight) / 2
    return { scale: Math.min(v.scale, MAX_SCALE), x: Math.max(-maxX, Math.min(maxX, v.x)), y: Math.max(-maxY, Math.min(maxY, v.y)) }
  }

  const toggleZoom = () => setView((v) => (v.scale > 1 ? RESET : clamp({ scale: TAP_ZOOM, x: 0, y: 0 })))

  const zoomToStamp = () => {
    const img = imgRef.current
    if (!img) return
    // Scaling happens around the centre: shift the bottom-left corner into view.
    setView(clamp({ scale: STAMP_ZOOM, x: ((STAMP_ZOOM - 1) * img.offsetWidth) / 2, y: (-(STAMP_ZOOM - 1) * img.offsetHeight) / 2 }))
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setGesturing(true)
    const g = gesture.current
    g.moved = false
    g.downAt = Date.now()
    g.startX = e.clientX
    g.startY = e.clientY
    g.startView = viewRef.current
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      if (a && b) {
        g.startDist = dist(a, b)
        g.startScale = viewRef.current.scale
      }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (dist({ x: e.clientX, y: e.clientY }, { x: g.startX, y: g.startY }) > TAP_SLOP_PX) g.moved = true
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      if (a && b && g.startDist > 0) setView(clamp({ ...viewRef.current, scale: Math.max(1, g.startScale * (dist(a, b) / g.startDist)) }))
    } else if (pointers.current.size === 1 && viewRef.current.scale > 1) {
      setView(clamp({ scale: g.startView.scale, x: g.startView.x + (e.clientX - g.startX), y: g.startView.y + (e.clientY - g.startY) }))
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const wasOnly = pointers.current.size === 1
    pointers.current.delete(e.pointerId)
    setGesturing(pointers.current.size > 0)
    const g = gesture.current
    if (!wasOnly) {
      g.startView = viewRef.current
      return
    }
    const dx = e.clientX - g.startX
    if (viewRef.current.scale === 1 && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(e.clientY - g.startY)) {
      go(dx < 0 ? 1 : -1)
    } else if (!g.moved && e.pointerType === 'touch' && Date.now() - g.downAt < TAP_MS) {
      toggleZoom() // a tap zooms on touch screens; a mouse uses double-click
    }
  }

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    setGesturing(pointers.current.size > 0)
  }

  if (!item) return null
  const zoomed = view.scale > 1
  const navBtn = 'absolute top-1/2 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-scrim/60 text-on-solid hover:bg-scrim/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid disabled:hidden'

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={`${t.title}: ${plateNo}`} className="fixed inset-0 z-50 flex flex-col bg-scrim text-on-solid">
      <header className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{item.label}</p>
          <p className="truncate text-sm text-slate-300">{plateNo} · {t.position(index + 1, items.length)}</p>
        </div>
        <button
          type="button"
          onClick={zoomToStamp}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-on-solid/10 px-3 text-sm font-medium hover:bg-on-solid/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid"
        >
          <ScanText aria-hidden className="size-4" />
          {t.zoomStamp}
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="grid size-11 place-items-center rounded-lg bg-on-solid/10 hover:bg-on-solid/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid"
        >
          <X aria-hidden className="size-6" />
        </button>
      </header>

      <div
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onDoubleClick={toggleZoom}
        style={{ cursor: zoomed ? 'grab' : 'zoom-in' }}
      >
        <div className="grid size-full place-items-center">
          {url.isPending ? (
            <Spinner className="size-8 text-on-solid" />
          ) : url.isError || !url.data ? (
            <div role="alert" className="space-y-3 text-center">
              <p>{t.loadFailed}</p>
              <button type="button" onClick={() => void url.refetch()} className="h-11 rounded-lg bg-surface px-4 text-sm font-medium text-ink">{t.retry}</button>
            </div>
          ) : (
            <img
              ref={imgRef}
              src={url.data}
              alt={`${item.label}: ${plateNo}`}
              draggable={false}
              className="max-h-full max-w-full object-contain will-change-transform"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: gesturing ? 'none' : 'transform 120ms ease-out' }}
            />
          )}
        </div>
        <button type="button" aria-label={t.previous} disabled={index === 0} onClick={() => go(-1)} className={cn(navBtn, 'left-3')}>
          <ChevronLeft aria-hidden className="size-7" />
        </button>
        <button type="button" aria-label={t.next} disabled={index === items.length - 1} onClick={() => go(1)} className={cn(navBtn, 'right-3')}>
          <ChevronRight aria-hidden className="size-7" />
        </button>
      </div>

      <footer className="flex items-center justify-center gap-2 px-4 py-3 text-center text-xs text-slate-300">
        <ZoomIn aria-hidden className="size-4 shrink-0" />
        <span>{t.hint} {t.stampHint}</span>
      </footer>
    </div>
  )
}
