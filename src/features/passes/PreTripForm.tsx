import { MapPin, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useUpdateLock } from '@/pwa/updateLock'
import { Button } from '@/components/ui/Button'
import { submitPass } from '@/lib/api'
import { apiErrorMessage, apiErrorReason } from '@/lib/errors'
import { evidencePath, type EvidenceFileName } from '@/lib/passPaths'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import type { FormContext, PassChecklistItem } from '@/types/passes'
import { CameraCapture, type CaptureResult } from './CameraCapture'
import { allOk, answersFromPrevious, checklistStatus, isAnswered, noteMissing, toPayload, type Answers } from './checklist'
import { ChecklistBlock } from './ChecklistBlock'
import { clearDraft, loadDraft, saveDraft } from './draft'
import { PhotoTile } from './PhotoTile'
import { usePhotoSlots, type SlotKey } from './usePhotoSlots'
import { useLocation } from './useLocation'

const t = strings.pass.form

/** Reasons that mean the pass changed under the driver: the only way forward is to open it again. */
const STALE_REASONS = new Set([
  'pass-exists', 'attempt-mismatch', 'attempts-exhausted', 'not-resubmitter', 'checklist-invalid',
  'vehicle-suspended', 'contractor-suspended', 'not-assigned', 'vehicle-not-found',
])
/** Uploads older than this are re-sent before submitting (the server refuses objects over 30 minutes old). */
const REFRESH_AFTER_MS = 25 * 60_000

interface Props {
  ctx: FormContext
  /** Resubmission only: shown on top, and the earlier answers are prefilled. Photos always start empty. */
  rejection?: { reason: string }
  previous?: PassChecklistItem[]
  onSubmitted: (result: { passId: string; attempt: number }) => void
  /** Ask the gate to resolve the vehicle again. */
  onReload: () => void
}

const formatDay = (dateKey: string): string => {
  const d = new Date(Number(dateKey.slice(0, 4)), Number(dateKey.slice(4, 6)) - 1, Number(dateKey.slice(6, 8)))
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export function PreTripForm({ ctx, rejection, previous, onSubmitted, onReload }: Props) {
  const { claims, profile } = useSession()
  // A new app version waits (and asks) while this form is open; the draft is saved, but a reload mid-photo loses the capture.
  useUpdateLock()
  const { vehicle, checklist, passSettings, attempt, dateKey } = ctx
  const maxExtra = Math.min(2, Math.max(0, passSettings.maxExtraPhotos))

  const [answers, setAnswers] = useState<Answers>(
    () => loadDraft(vehicle.id, dateKey) ?? (previous ? answersFromPrevious(checklist, previous) : {}),
  )
  useEffect(() => {
    saveDraft(vehicle.id, dateKey, answers)
  }, [vehicle.id, dateKey, answers])

  const photos = usePhotoSlots((key: SlotKey) =>
    evidencePath(claims.tenantId, vehicle.id, dateKey, attempt, `${key}.jpg` as EvidenceFileName),
  )
  const [camera, setCamera] = useState<SlotKey | null>(null)
  const location = useLocation(passSettings.requireLocation)

  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null)

  const status = checklistStatus(checklist, answers)
  const { slots } = photos
  const extraKeys = (['extra1', 'extra2'] as const).slice(0, maxExtra)
  const filledExtras = extraKeys.filter((k) => slots[k])
  const requiredDone = slots.gps?.status === 'done' && slots.dashcam?.status === 'done'
  const extrasDone = filledExtras.every((k) => slots[k]?.status === 'done')
  const uploading = [slots.gps, slots.dashcam, ...filledExtras.map((k) => slots[k])].some((s) => s?.status === 'uploading')
  const locationOk = !passSettings.requireLocation || location.state.status === 'ok'

  const validItems = checklist.filter((i) => isAnswered(answers, i.id) && !noteMissing(answers, i.id) && !status.blocked.includes(i)).length
  const total = 2 + checklist.length
  const done = (slots.gps?.status === 'done' ? 1 : 0) + (slots.dashcam?.status === 'done' ? 1 : 0) + validItems

  const canSubmit = requiredDone && extrasDone && status.complete && locationOk && !submitting
  const hint = useMemo(() => {
    if (!slots.gps || !slots.dashcam) return t.needPhotos
    if (uploading) return t.waitingUploads
    if (passSettings.requireLocation && location.state.status === 'pending') return t.locationWaiting
    if (!locationOk) return t.locationFailed
    return null
  }, [slots.gps, slots.dashcam, uploading, passSettings.requireLocation, location.state.status, locationOk])

  const openCamera = (key: SlotKey) => !submitting && setCamera(key)
  const onCaptured = (r: CaptureResult) => {
    if (camera) photos.capture(camera, r.blob, { method: r.method, capturedAt: r.capturedAt })
    setCamera(null)
  }

  const submit = async () => {
    if (!canSubmit || submittingRef.current) return
    const gps = slots.gps
    const dashcam = slots.dashcam
    if (!gps || !dashcam) return
    submittingRef.current = true // block double-submit before React re-renders
    setSubmitting(true)
    setError(null)
    try {
      if (!(await photos.refreshStale(REFRESH_AFTER_MS))) {
        setError({ message: strings.apiErrors['evidence-missing'], stale: false })
        return
      }
      const method = [gps, dashcam, ...filledExtras.map((k) => slots[k])].some((s) => s?.method === 'file') ? 'file' : 'live'
      const result = await submitPass({
        vehicleId: vehicle.id,
        attempt,
        checklist: toPayload(checklist, answers),
        extraCount: filledExtras.length,
        captureMeta: {
          method,
          clientCapturedAt: { gps: gps.capturedAt, dashcam: dashcam.capturedAt },
          ...(location.state.status === 'ok' ? { location: location.state.position } : {}),
        },
      })
      clearDraft(vehicle.id, dateKey)
      onSubmitted({ passId: result.passId, attempt: result.attempt })
    } catch (e) {
      const reason = apiErrorReason(e)
      setError({ message: apiErrorMessage(e), stale: reason !== null && STALE_REASONS.has(reason) })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="pb-40">
      <header className="space-y-1 border-b border-slate-300 bg-surface px-4 py-5">
        <p className="text-sm font-medium text-slate-600">{t.title}</p>
        <h1 className="text-4xl font-extrabold tracking-tight">{vehicle.plateNo}</h1>
        <p className="text-base text-slate-700">{vehicle.type}</p>
        <p className="text-sm text-slate-600">
          {t.driver}: <span className="font-semibold text-ink">{profile.name}</span> · {t.today}:{' '}
          <span className="font-semibold text-ink">{formatDay(dateKey)}</span>
        </p>
      </header>

      <div className="mx-auto max-w-md space-y-8 px-4 py-6">
        {rejection && (
          <div role="alert" className="rounded-2xl border-2 border-danger-strong bg-danger-soft p-4 text-danger-ink">
            <p className="flex items-center gap-2 font-bold"><TriangleAlert aria-hidden className="size-5" /> {t.reasonBanner}</p>
            <p className="mt-1 text-base">{rejection.reason}</p>
          </div>
        )}

        <section aria-labelledby="photos-h" className="space-y-3">
          <h2 id="photos-h" className="text-lg font-bold">{t.photosTitle}</h2>
          <PhotoTile label={t.gps} hint={t.gpsHint} slot={slots.gps} onOpen={() => openCamera('gps')} onRetry={() => photos.retry('gps')} />
          <PhotoTile label={t.dashcam} hint={t.dashcamHint} slot={slots.dashcam} onOpen={() => openCamera('dashcam')} onRetry={() => photos.retry('dashcam')} />
        </section>

        <section aria-labelledby="chk-h" className="space-y-3">
          <h2 id="chk-h" className="text-lg font-bold">{t.checklistTitle}</h2>
          <ChecklistBlock items={checklist} answers={answers} onChange={setAnswers} onAllOk={() => setAnswers(allOk(checklist))} disabled={submitting} />
        </section>

        {maxExtra > 0 && (
          <section aria-labelledby="extra-h" className="space-y-3">
            <div>
              <h2 id="extra-h" className="text-lg font-bold">{t.extraTitle}</h2>
              <p className="text-sm text-slate-600">{t.extraHint}</p>
            </div>
            {extraKeys.map((key, i) => {
              const slot = slots[key]
              // Filled extras are always contiguous (only the last one can be removed): show them, then one "add" tile.
              if (!slot && i !== filledExtras.length) return null
              const isLast = i === filledExtras.length - 1
              return (
                <PhotoTile
                  key={key}
                  label={slot ? t.extraN(i + 1) : t.addExtra}
                  slot={slot}
                  onOpen={() => openCamera(key)}
                  onRetry={() => photos.retry(key)}
                  {...(slot && isLast ? { onRemove: () => photos.remove(key) } : {})}
                />
              )
            })}
          </section>
        )}

        {passSettings.requireLocation && (
          <section className="space-y-2 rounded-2xl border border-slate-300 bg-surface p-4" aria-label={t.locationNote}>
            <p className="flex items-start gap-2 text-sm text-slate-700">
              <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" /> {t.locationNote}
            </p>
            {location.state.status === 'unavailable' && (
              <div className="space-y-2">
                <p role="alert" className="text-sm font-semibold text-danger-strong">{t.locationFailed}</p>
                <Button variant="secondary" className="h-12" onClick={location.retry}>{t.locationRetry}</Button>
              </div>
            )}
          </section>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-300 bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-md space-y-2">
          {error && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger-ink">
              <span>{error.message}</span>
              {error.stale && <Button variant="secondary" size="sm" onClick={onReload}>{strings.pass.status.reopen}</Button>}
            </div>
          )}
          {!error && hint && !canSubmit && <p className="text-center text-sm text-slate-700">{hint}</p>}
          <div className="flex items-center gap-3">
            <p className="w-24 shrink-0 text-sm font-semibold text-slate-800" aria-live="polite">{t.progress(done, total)}</p>
            <Button className="h-14 flex-1 text-lg font-bold" disabled={!canSubmit} loading={submitting} onClick={() => void submit()}>
              {submitting ? t.submitting : t.submit}
            </Button>
          </div>
        </div>
      </div>

      {camera && (
        <CameraCapture
          label={camera === 'gps' ? t.gps : camera === 'dashcam' ? t.dashcam : t.extraN(camera === 'extra1' ? 1 : 2)}
          plateNo={vehicle.plateNo}
          onCapture={onCaptured}
          onClose={() => setCamera(null)}
        />
      )}
    </div>
  )
}
