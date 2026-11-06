import { Camera, ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { strings } from '@/lib/strings'
import { compressPenaltyPhoto } from './photo'

const t = strings.penalties.issue

interface Props {
  value: Blob | null
  onChange: (photo: Blob | null) => void
  disabled?: boolean
}

/**
 * Optional photo evidence. A phone gets a "Take photo" button (opens the camera) and a gallery picker; a desktop gets the
 * file picker only. The image is resized and compressed in the browser as soon as it is chosen.
 */
export function PenaltyPhotoField({ value, onChange, disabled }: Props) {
  const camera = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const previewRef = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (photo: Blob | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = photo ? URL.createObjectURL(photo) : null
    setPreview(previewRef.current)
    onChange(photo)
  }
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    },
    [],
  )

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      update(await compressPenaltyPhoto(file))
    } catch {
      setError(t.photoFailed)
    } finally {
      setBusy(false)
      if (camera.current) camera.current.value = ''
      if (files.current) files.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <p className="flex items-baseline justify-between text-sm font-medium text-slate-700">
        <span>{t.photo}</span>
        <span className="text-xs font-normal text-slate-600">{strings.common.optional}</span>
      </p>
      {preview && <img src={preview} alt="" className="max-h-56 w-full max-w-sm rounded-lg border border-slate-200 object-contain" />}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" className="hidden pointer-coarse:inline-flex" icon={<Camera aria-hidden className="size-4" />} loading={busy} disabled={disabled} onClick={() => camera.current?.click()}>
          {t.takePhoto}
        </Button>
        <Button variant="secondary" size="sm" icon={<ImagePlus aria-hidden className="size-4" />} loading={busy} disabled={disabled} onClick={() => files.current?.click()}>
          {value ? t.changePhoto : t.choosePhoto}
        </Button>
        {value && (
          <Button variant="ghost" size="sm" icon={<X aria-hidden className="size-4" />} disabled={disabled} onClick={() => update(null)}>
            {t.removePhoto}
          </Button>
        )}
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label={t.takePhoto} onChange={(e) => void pick(e.target.files?.[0])} />
      <input ref={files} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label={t.choosePhoto} onChange={(e) => void pick(e.target.files?.[0])} />
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
