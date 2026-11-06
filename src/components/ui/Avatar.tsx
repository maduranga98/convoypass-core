import { useState } from 'react'
import { cn } from '@/lib/cn'

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?'

/** Photo when a URL is available (and loads), otherwise initials. */
export function Avatar({ name, src, alt, className }: { name: string; src?: string | null | undefined; alt?: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const showPhoto = Boolean(src) && failed !== src
  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-medium text-slate-600',
        className,
      )}
    >
      {showPhoto ? (
        <img src={src as string} alt={alt ?? ''} loading="lazy" onError={() => setFailed(src ?? null)} className="size-full object-cover" />
      ) : (
        <span aria-hidden={alt === undefined ? undefined : true}>{initials(name)}</span>
      )}
    </span>
  )
}
