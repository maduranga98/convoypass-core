import { useQueryClient } from '@tanstack/react-query'
import { Download, FileUp } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { importVehicles } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { useTenantDocuments } from '@/features/shared/documents'
import { useContractorList } from '@/features/shared/queries'
import { useScope, type Scope } from '@/features/shared/scope'
import { downloadText, parseVehicleCsv, TEMPLATE_CSV, toCsv, type CsvRow } from './csv'
import { importInChunks, type RowOutcome } from './importRunner'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.vehicles.import
const PREVIEW_ROWS = 200

type Step =
  | { name: 'pick' }
  | { name: 'preview'; fileName: string; rows: CsvRow[]; truncated: boolean }
  | { name: 'importing'; done: number; total: number }
  | { name: 'done'; imported: number; failed: { raw: CsvRow['raw']; error: string }[] }

const rowError = (code: string): string => (t.rowErrors as Record<string, string>)[code] ?? code

export function VehicleImportModal({ scope, open, onClose }: { scope: Scope; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={t.title} variant="drawer">
      {open && <ImportFlow scope={scope} onClose={onClose} />}
    </Modal>
  )
}

function ImportFlow({ scope, onClose }: { scope: Scope; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { isAdmin } = useScope(scope)
  const contractors = useContractorList(scope)
  const { vehicleTypes } = useTenantDocuments()
  const input = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>({ name: 'pick' })
  const [contractorId, setContractorId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const active = (contractors.data ?? []).filter((c) => c.status === 'active')
  const canPick = !isAdmin || contractorId !== ''

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    const parsed = parseVehicleCsv(await file.text(), vehicleTypes)
    if (input.current) input.current.value = ''
    if (!parsed.ok) {
      setError(parsed.reason === 'header' ? t.headerError : t.fileEmpty)
      return
    }
    setStep({ name: 'preview', fileName: file.name, rows: parsed.rows, truncated: parsed.truncated })
  }

  const run = async (rows: CsvRow[]) => {
    const valid = rows.filter((r) => r.value !== null)
    setStep({ name: 'importing', done: 0, total: valid.length })
    const outcomes: RowOutcome[] = await importInChunks(
      valid,
      async (chunk) => (await importVehicles({ ...(isAdmin ? { contractorId } : {}), rows: chunk })).results,
      { describeError: apiErrorMessage, onProgress: (done, total) => setStep({ name: 'importing', done, total }) },
    )
    await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    const failed = [
      ...rows.filter((r) => r.value === null).map((r) => ({ raw: r.raw, error: r.error ?? '' })),
      ...outcomes.filter((o) => !o.ok).map((o) => ({ raw: o.row.raw, error: rowError(o.error ?? 'internal') })),
    ]
    const imported = outcomes.filter((o) => o.ok).length
    if (imported > 0) toast.success(t.imported(imported))
    setStep({ name: 'done', imported, failed })
  }

  return (
    <div className="space-y-5">
      {step.name === 'pick' && (
        <>
          {isAdmin && (
            <Select label={strings.vehicles.form.contractor} hint={canPick ? undefined : t.pickContractor} value={contractorId} onChange={(e) => setContractorId(e.target.value)} disabled={contractors.isPending}>
              <option value="">{strings.vehicles.form.contractorPlaceholder}</option>
              {active.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          {error && (
            <NotificationBanner tone="error">{error}</NotificationBanner>
          )}
          <div className="space-y-3 rounded-xl border border-dashed border-slate-300 p-6 text-center">
            <FileUp aria-hidden className="mx-auto size-8 text-slate-300" />
            <p className="text-sm text-slate-500">{t.hint}</p>
            <Button icon={<FileUp aria-hidden className="size-4" />} disabled={!canPick} onClick={() => input.current?.click()}>
              {t.chooseFile}
            </Button>
            <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-label={t.chooseFile} onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
          <Button variant="secondary" className="w-full" icon={<Download aria-hidden className="size-4" />} onClick={() => downloadText('convoypass-vehicles-template.csv', TEMPLATE_CSV)}>
            {t.template}
          </Button>
        </>
      )}

      {step.name === 'preview' && <Preview step={step} onBack={() => setStep({ name: 'pick' })} onImport={() => void run(step.rows)} />}

      {step.name === 'importing' && (
        <div role="status" className="space-y-3 py-10 text-center">
          <p className="text-sm font-medium">{t.importing}</p>
          <progress className="h-2 w-full accent-accent" value={step.done} max={Math.max(step.total, 1)} aria-label={t.importing} />
          <p className="text-xs text-slate-500">
            {step.done} / {step.total}
          </p>
        </div>
      )}

      {step.name === 'done' && (
        <Summary
          imported={step.imported}
          failed={step.failed}
          onAnother={() => setStep({ name: 'pick' })}
          onClose={onClose}
        />
      )}
    </div>
  )
}

function Preview({ step, onBack, onImport }: { step: Extract<Step, { name: 'preview' }>; onBack: () => void; onImport: () => void }) {
  const valid = useMemo(() => step.rows.filter((r) => r.value !== null).length, [step.rows])
  const invalid = step.rows.length - valid
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t.previewTitle}</h3>
        <p className="mt-0.5 truncate text-xs text-slate-500">{step.fileName}</p>
        <p className="mt-2 flex flex-wrap gap-x-3 text-sm">
          <span className="text-success-strong">{t.valid(valid)}</span>
          {invalid > 0 && <span className="text-danger-strong">{t.invalid(invalid)}</span>}
        </p>
        {step.truncated && <p className="mt-1 text-xs text-warning-strong">{t.tooMany(2000)}</p>}
      </div>
      <div className="max-h-96 overflow-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">{t.rowCol}</th>
              <th scope="col" className="px-3 py-2 font-medium">{strings.vehicles.columns.plate}</th>
              <th scope="col" className="px-3 py-2 font-medium">{strings.vehicles.columns.type}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t.statusCol}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {step.rows.slice(0, PREVIEW_ROWS).map((r) => (
              <tr key={r.line} className={r.value ? '' : 'bg-danger-soft/60'}>
                <td className="px-3 py-2 tabular-nums text-slate-500">{r.line}</td>
                <td className="px-3 py-2 font-mono">{r.raw.plateNo || strings.common.none}</td>
                <td className="px-3 py-2">{r.raw.type || strings.common.none}</td>
                <td className={r.value ? 'px-3 py-2 text-success-strong' : 'px-3 py-2 text-danger-strong'}>{r.value ? t.ok : r.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {step.rows.length > PREVIEW_ROWS && <p className="text-xs text-slate-500">{strings.list.capNotice(PREVIEW_ROWS)}</p>}
      {valid === 0 && <p className="text-sm text-slate-500">{t.nothingValid}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onBack}>
          {strings.common.cancel}
        </Button>
        <Button disabled={valid === 0} onClick={onImport}>
          {t.importValid(valid)}
        </Button>
      </div>
    </div>
  )
}

function Summary({ imported, failed, onAnother, onClose }: { imported: number; failed: { raw: CsvRow['raw']; error: string }[]; onAnother: () => void; onClose: () => void }) {
  const downloadFailed = () =>
    downloadText(
      'convoypass-vehicles-failed.csv',
      toCsv(failed.map((f) => ({ ...f.raw, error: f.error })), ['plateNo', 'type', 'makeModel', 'error']),
    )
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">{t.summaryTitle}</h3>
        <p className="mt-2 flex flex-wrap gap-x-4 text-sm" role="status">
          <span className="text-success-strong">{t.imported(imported)}</span>
          <span className={failed.length > 0 ? 'text-danger-strong' : 'text-slate-500'}>{t.failed(failed.length)}</span>
        </p>
      </div>
      {failed.length > 0 && (
        <>
          <ul className="max-h-64 divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-200 text-xs">
            {failed.slice(0, PREVIEW_ROWS).map((f, i) => (
              <li key={i} className="flex justify-between gap-3 px-3 py-2">
                <span className="font-mono">{f.raw.plateNo || strings.common.none}</span>
                <span className="text-right text-danger-strong">{f.error}</span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="w-full" icon={<Download aria-hidden className="size-4" />} onClick={downloadFailed}>
            {t.downloadFailed}
          </Button>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onAnother}>
          {t.another}
        </Button>
        <Button onClick={onClose}>{strings.common.done}</Button>
      </div>
    </div>
  )
}
