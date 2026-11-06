import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { Button } from './Button'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /**
   * `drawer` slides in from the right on desktop and fills the screen on mobile. `sheet` is a bottom sheet on
   * mobile and a centred dialog from `sm` up.
   */
  variant?: 'center' | 'drawer' | 'sheet'
  footer?: ReactNode
  /** `false`: no close button, Escape and the backdrop do nothing; the content's own button closes it (one-time PIN card). */
  dismissible?: boolean
}

/** Built on the native <dialog>: focus trapping, Escape to close and inert background come for free. */
export function Modal({ open, onClose, title, children, variant = 'center', footer, dismissible = true }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    // Backdrop click is a pointer convenience only: keyboard users close with Escape (native) or the Close button.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        if (!dismissible) e.preventDefault() // Escape
      }}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose() // backdrop click
      }}
      className={cn(
        'bg-surface p-0 text-ink shadow-xl backdrop:bg-brand/40',
        variant === 'center' && 'm-auto w-[calc(100%-2rem)] max-w-md rounded-xl',
        variant === 'drawer' && 'my-0 ml-auto mr-0 h-dvh max-h-dvh w-full max-w-none sm:max-w-md',
        variant === 'sheet' &&
          'mx-0 mb-0 mt-auto w-full max-w-none rounded-t-2xl sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-md sm:rounded-xl',
      )}
    >
      {open && (
        <div className={cn('flex flex-col', variant === 'drawer' ? 'h-dvh' : 'max-h-[85dvh]')}>
          <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-4">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {dismissible && (
              <Button variant="ghost" size="icon" onClick={onClose} aria-label={strings.common.close}>
                <X aria-hidden className="size-5" />
              </Button>
            )}
          </header>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}
