import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'

export type BannerTone = 'error' | 'warning' | 'success' | 'info'

const TONES: Record<BannerTone, { box: string; icon: string; Icon: typeof Info; role: 'alert' | 'status' }> = {
  error: { box: 'border-danger-strong bg-danger-soft text-danger-ink', icon: 'text-danger-strong', Icon: CircleAlert, role: 'alert' },
  warning: { box: 'border-accent bg-warning-soft text-warning-ink', icon: 'text-warning-strong', Icon: TriangleAlert, role: 'status' },
  success: { box: 'border-success bg-success-soft text-success-ink', icon: 'text-success-strong', Icon: CircleCheck, role: 'status' },
  info: { box: 'border-slate-500 bg-slate-100 text-ink', icon: 'text-slate-600', Icon: Info, role: 'status' },
}

interface Props {
  tone?: BannerTone
  /** Optional bold first line; `children` is the message. */
  title?: string
  children?: ReactNode
  /** A retry / "reload" style control, shown on the right (wraps below the text on a narrow screen). */
  action?: ReactNode
  /** Shows a close button. The banner owns no state: the caller decides what dismissing means. */
  onDismiss?: () => void
  /** `lg` is for the gate screens, where text is read at arm's length. */
  size?: 'md' | 'lg'
  role?: 'alert' | 'status' | 'note'
  className?: string
}

/**
 * The one way the app shows an error, warning, confirmation or tip inline: same colours, icon, spacing and ARIA role
 * everywhere. Errors announce immediately (`alert`); everything else is polite (`status`) unless a role is given.
 */
export function NotificationBanner({ tone = 'info', title, children, action, onDismiss, size = 'md', role, className }: Props) {
  const t = TONES[tone]
  return (
    <div
      role={role ?? t.role}
      className={cn(
        'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border-l-4 px-3 py-2.5 text-sm',
        size === 'lg' && 'rounded-xl py-3 text-base font-semibold',
        t.box,
        className,
      )}
    >
      <t.Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', size === 'lg' && 'size-5', t.icon)} />
      <div className="min-w-0 flex-1 break-words">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : undefined}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={strings.common.dismiss}
          className="-m-1.5 inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-brand/5 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus sm:size-9"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  )
}
