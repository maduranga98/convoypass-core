import { ImageOff, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useDriverPhotoUrl } from '@/features/shared/queries'
import { strings } from '@/lib/strings'
import type { Driver } from '@/types'

const t = strings.gate

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'

/**
 * Large driver photo for comparing faces, tap to enlarge. The URL is fetched on demand from the stored path and
 * cached (never stored on the phone); without a connection the initials show instead. Missing photo: amber warning.
 */
export function DriverPhoto({ driver, name, online }: { driver: Pick<Driver, 'photoPath' | 'updatedAt'> | null; name: string; online: boolean }) {
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState<string | null>(null)
  const url = useDriverPhotoUrl(driver?.photoPath, driver?.updatedAt?.seconds)
  const hasPath = Boolean(driver?.photoPath)
  const src = url.data && broken !== url.data ? url.data : null

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      {src ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t.enlargePhoto(name)}
          className="size-32 overflow-hidden rounded-2xl border-2 border-slate-300 bg-slate-100 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus sm:size-36"
        >
          <img src={src} alt={t.photoOf(name)} onError={() => setBroken(src)} className="size-full object-cover" />
        </button>
      ) : (
        <span aria-hidden className="grid size-32 place-items-center rounded-2xl border-2 border-slate-300 bg-slate-100 text-4xl font-black text-slate-600 sm:size-36">
          {initials(name)}
        </span>
      )}
      {!hasPath && driver !== null && (
        <span className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-extrabold text-ink">
          <TriangleAlert aria-hidden className="size-3.5" />
          {t.noPhoto}
        </span>
      )}
      {hasPath && !src && (!online || url.isError) && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
          <ImageOff aria-hidden className="size-3.5" />
          {t.photoOffline}
        </span>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={name}>
        {src && <img src={src} alt={t.photoOf(name)} className="mx-auto max-h-[70dvh] w-full rounded-xl object-contain" />}
      </Modal>
    </div>
  )
}
