import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'

export function Spinner({ className, label = strings.common.loading }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 aria-hidden className={cn('size-5 animate-spin text-slate-500', className)} />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function PageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner className="size-6" />
    </div>
  )
}
