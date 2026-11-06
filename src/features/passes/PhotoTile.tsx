import { Camera, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import type { Slot } from './usePhotoSlots'

const t = strings.pass.form

/** Upload progress ring around the thumbnail. */
function Ring({ value }: { value: number }) {
  const r = 18
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 44 44" className="size-11 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.35)" strokeWidth="4" />
      <circle
        cx="22" cy="22" r={r} fill="none" stroke="var(--color-on-solid)" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - value)}
      />
    </svg>
  )
}

interface Props {
  label: string
  hint?: string
  slot: Slot | undefined
  onOpen: () => void
  onRetry: () => void
  onRemove?: () => void
}

export function PhotoTile({ label, hint, slot, onOpen, onRetry, onRemove }: Props) {
  if (!slot) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-400 bg-surface px-4 py-6 text-ink hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <Camera aria-hidden className="size-9 text-ink" />
        <span className="text-lg font-semibold">{label}</span>
        {hint && <span className="text-sm text-slate-600">{hint}</span>}
        <span className="mt-1 inline-flex h-12 items-center rounded-lg bg-brand px-5 text-base font-semibold text-on-solid">{t.takePhoto}</span>
      </button>
    )
  }

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-300 bg-surface p-3">
      <div className="relative size-28 shrink-0 overflow-hidden rounded-xl bg-slate-200">
        <img src={slot.previewUrl} alt={label} className="size-full object-cover" />
        {slot.status === 'uploading' && (
          <div className="absolute inset-0 grid place-items-center">
            <Ring value={slot.progress} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-base font-semibold">{label}</p>
        <p
          role={slot.status === 'error' ? 'alert' : 'status'}
          className={cn('text-sm font-medium', slot.status === 'done' && 'text-success-strong', slot.status === 'error' && 'text-danger-strong', slot.status === 'uploading' && 'text-slate-700')}
        >
          {slot.status === 'done' ? t.uploaded : slot.status === 'error' ? t.uploadFailed : `${t.uploading} ${Math.round(slot.progress * 100)}%`}
        </p>
        <div className="flex flex-wrap gap-2">
          {slot.status === 'error' && (
            <Button size="md" className="h-12" icon={<RefreshCw aria-hidden className="size-4" />} onClick={onRetry}>
              {t.retryUpload}
            </Button>
          )}
          <Button variant="secondary" className="h-12" icon={<RotateCcw aria-hidden className="size-4" />} onClick={onOpen}>
            {t.retake}
          </Button>
          {onRemove && (
            <Button variant="ghost" className="h-12" icon={<Trash2 aria-hidden className="size-4" />} onClick={onRemove}>
              {t.remove}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
