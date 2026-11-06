import { cn } from '@/lib/cn'

/** The ConvoyPass logo (public/android-chrome-192x192.png). Decorative when the name is printed next to it. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/android-chrome-192x192.png"
      alt=""
      width={192}
      height={192}
      decoding="async"
      className={cn('size-9 shrink-0 rounded-lg', className)}
    />
  )
}
