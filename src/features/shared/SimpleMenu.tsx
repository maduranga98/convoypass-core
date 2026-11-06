import { Menu } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  /** A toggle shows its state (`aria-pressed`). */
  pressed?: boolean
}

/**
 * A menu icon that opens a short list of large buttons (driver and security homes, Module 12). Escape or a tap outside
 * closes it; every item is a real button reachable by keyboard.
 */
export function SimpleMenu({ label, items, tone = 'light' }: { label: string; items: MenuItem[]; tone?: 'light' | 'dark' }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex size-14 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          tone === 'dark' ? 'text-on-solid hover:bg-on-solid/15' : 'text-ink hover:bg-slate-100',
        )}
      >
        <Menu aria-hidden className="size-7" />
      </button>
      {open && (
        <ul id={id} className="absolute top-full right-0 z-30 mt-1 w-60 space-y-1 rounded-2xl border border-slate-200 bg-surface p-2 shadow-lg">
          {items.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                {...(item.pressed !== undefined ? { 'aria-pressed': item.pressed } : {})}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left text-lg font-semibold text-ink hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-focus"
              >
                {item.icon}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
