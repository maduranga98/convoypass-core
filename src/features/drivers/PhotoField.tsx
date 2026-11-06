import { Camera, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { strings } from '@/lib/strings'
import { compressPhoto } from './photo'

const t = strings.drivers.form

interface Props {
  name: string
  /** Current photo (edit mode). */
  currentUrl?: string | null
  /** Compressed JPEG ready for upload, or null. */
  value: Blob | null
  onChange: (photo: Blob | null) => void
  disabled?: boolean
}

/** Camera or file picker. The image is compressed in the browser as soon as it is chosen. */
export function PhotoField({ name, currentUrl, value, onChange, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const previewRef = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Object URLs are created when a photo is chosen and revoked when replaced, removed or unmounted.
  const update = (photo: Blob | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = photo ? URL.createObjectURL(photo) : null
    setPreview(previewRef.current)
    onChange(photo)
  }
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
  }, [])

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      update(await compressPhoto(file))
    } catch {
      setError(t.photoFailed)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="flex items-baseline justify-between text-sm font-medium text-slate-700">
        <span>{t.photo}</span>
        <span className="text-xs font-normal text-slate-600">{strings.common.optional}</span>
      </p>
      <div className="flex items-center gap-3">
        <Avatar name={name || '?'} src={preview ?? currentUrl ?? null} alt="" className="size-16 text-base" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<Camera aria-hidden className="size-4" />} loading={busy} disabled={disabled} onClick={() => input.current?.click()}>
            {value || currentUrl ? t.changePhoto : t.takePhoto}
          </Button>
          {value && (
            <Button variant="ghost" size="sm" icon={<X aria-hidden className="size-4" />} disabled={disabled} onClick={() => update(null)}>
              {t.removeSelected}
            </Button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-label={t.photo}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        <p className="text-xs text-slate-500">{t.photoHint}</p>
      )}
    </div>
  )
}
