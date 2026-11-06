import { Archive, ImageOff } from 'lucide-react'
import { useState } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useEvidenceUrl } from './useEvidenceUrl'

interface Props {
  path: string
  alt: string
  className?: string
  /** The retention job removed this pass's photos: show that instead of asking Storage (which would fail). */
  removed?: boolean
}

/** A photo from Storage, shown through the cached URL query. The bottom-left stamp stays in view. */
export function EvidenceThumb({ path, alt, className, removed = false }: Props) {
  const url = useEvidenceUrl(removed ? null : path)
  const [broken, setBroken] = useState(false)

  if (removed) {
    return (
      <span role="img" aria-label={strings.retention.removed} title={strings.retention.removed} className={cn('grid size-full place-items-center bg-slate-100 text-slate-600', className)}>
        <Archive aria-hidden className="size-5" />
      </span>
    )
  }
  if (url.isPending) return <Skeleton className={cn('size-full', className)} />
  if (url.isError || broken || !url.data) {
    return (
      <span role="img" aria-label={strings.approvals.evidence.loadFailed} className={cn('grid size-full place-items-center bg-slate-100 text-slate-500', className)}>
        <ImageOff aria-hidden className="size-6" />
      </span>
    )
  }
  return (
    <img
      src={url.data}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setBroken(true)}
      className={cn('size-full bg-slate-200 object-cover object-left-bottom', className)}
    />
  )
}
