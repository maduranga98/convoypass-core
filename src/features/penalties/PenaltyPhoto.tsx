import { ImageOff } from 'lucide-react'
import { useState } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useEvidenceUrl } from '@/features/passes/useEvidenceUrl'

/** A penalty's photo evidence (Storage path, read through the cached URL query). Opens the full photo in a new tab. */
export function PenaltyPhoto({ path, className, alt = strings.penalties.detail.photoAlt }: { path: string; className?: string; alt?: string }) {
  const url = useEvidenceUrl(path)
  const [broken, setBroken] = useState(false)
  const frame = cn('overflow-hidden rounded-lg border border-slate-200 bg-slate-100', className)

  if (url.isPending) return <Skeleton className={frame} />
  if (url.isError || broken || !url.data) {
    return (
      <span role="img" aria-label={strings.approvals.evidence.loadFailed} className={cn(frame, 'grid place-items-center text-slate-500')}>
        <ImageOff aria-hidden className="size-6" />
      </span>
    )
  }
  return (
    <a href={url.data} target="_blank" rel="noreferrer" className={cn(frame, 'block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus')}>
      <img src={url.data} alt={alt} loading="lazy" draggable={false} onError={() => setBroken(true)} className="size-full object-cover" />
    </a>
  )
}
