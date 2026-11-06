import { Download, FileSpreadsheet, Printer } from 'lucide-react'
import { lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ChartPanel } from '@/features/shared/ChartPanel'
import { strings } from '@/lib/strings'
import type { ReportResult, SummarySection, SummaryTile } from '@/types/reports'
import { csvBlob, toCsv } from './exports/csv'
import { download } from './exports/download'
import { fileNameOf, formatInZone } from './exports/format'
import { ReportTable, SimpleTable } from './ReportTable'
import { pageCount, pageOf, sortRows, type Sort } from './sort'

const t = strings.reports
const ContractorActivityChart = lazy(() => import('./ReportCharts').then((m) => ({ default: m.ContractorActivityChart })))
const CountChart = lazy(() => import('./ReportCharts').then((m) => ({ default: m.CountChart })))
const TurnaroundChart = lazy(() => import('./ReportCharts').then((m) => ({ default: m.TurnaroundChart })))

const tileText = (tile: SummaryTile): string =>
  typeof tile.value === 'string'
    ? tile.value
    : tile.type === 'percent'
      ? `${(Math.round(tile.value * 1000) / 10).toFixed(1)}%`
      : tile.type === 'minutes'
        ? tile.value.toFixed(1)
        : String(tile.value)

function Tiles({ tiles }: { tiles: SummaryTile[] }) {
  return (
    <section aria-label={t.summary}>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 print:grid-cols-4">
        {tiles.map((tile) => (
          <li key={tile.key} className="rounded-xl border border-slate-200 bg-surface p-4 print:rounded-none">
            <p className="text-sm text-slate-600">{tile.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{tileText(tile)}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function sectionOf(result: ReportResult, key: string): SummarySection | undefined {
  return result.summary.sections.find((s) => s.key === key)
}

/** The chart (with its table version) that suits the report, and the remaining breakdown tables. */
function Charts({ result }: { result: ReportResult }) {
  const tz = result.timezone
  const charted: string[] = []
  let chart: React.ReactNode = null
  if (result.type === 'contractor_activity' && result.rows.some((r) => !r.isTotal)) {
    const cols = result.columns.filter((c) => ['contractor', 'submissions', 'checkedIn', 'rejections'].includes(c.key))
    chart = (
      <ChartPanel
        title={t.types.contractor_activity.title}
        label={`${t.types.contractor_activity.title}: ${t.contractorChart.submissions}, ${t.contractorChart.checkedIn}, ${t.contractorChart.rejections}`}
        chart={<ContractorActivityChart rows={result.rows} />}
        table={<SimpleTable columns={cols} rows={result.rows} timeZone={tz} caption={t.types.contractor_activity.title} />}
      />
    )
  }
  const reason = result.type === 'rejections' ? sectionOf(result, 'byReason') : undefined
  if (reason && reason.rows.length > 0) {
    charted.push('byReason')
    chart = (
      <ChartPanel
        title={reason.title}
        label={`${t.types.rejections.title}: ${reason.title}`}
        chart={<CountChart rows={reason.rows} label={t.types.rejections.title} />}
        table={<SimpleTable columns={reason.columns} rows={reason.rows} timeZone={tz} caption={reason.title} />}
      />
    )
  }
  const overall = result.type === 'turnaround' ? sectionOf(result, 'overall') : undefined
  if (overall && overall.rows.some((r) => r.count)) {
    charted.push('overall')
    chart = (
      <ChartPanel
        title={overall.title}
        label={`${t.types.turnaround.title}: ${overall.title}`}
        chart={<TurnaroundChart rows={overall.rows} />}
        table={<SimpleTable columns={overall.columns} rows={overall.rows} timeZone={tz} caption={overall.title} />}
      />
    )
  }
  const rest = result.summary.sections.filter((s) => !charted.includes(s.key) && s.rows.length > 0)
  return (
    <>
      {chart}
      {rest.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
          {rest.map((s) => (
            <section key={s.key} aria-label={s.title} className="space-y-2 rounded-xl border border-slate-200 bg-surface p-4 print:break-inside-avoid">
              <h2 className="text-base font-semibold">{s.title}</h2>
              <SimpleTable columns={s.columns} rows={s.rows} timeZone={tz} caption={s.title} />
            </section>
          ))}
        </div>
      )}
    </>
  )
}

/** Summary, chart, sortable table and the export/print toolbar for one report result. */
export function ReportView({ result, filterLines }: { result: ReportResult; filterLines: string[] }) {
  const [sort, setSort] = useState<Sort | null>(null)
  const [page, setPage] = useState(1)
  const [printing, setPrinting] = useState(false)
  const [busy, setBusy] = useState<'csv' | 'xlsx' | null>(null)
  const info = t.types[result.type]
  const tz = result.timezone

  const sorted = useMemo(() => sortRows(result.rows, result.columns, sort), [result.rows, result.columns, sort])
  const total = sorted.filter((r) => !r.isTotal).length
  const safePage = Math.min(page, pageCount(total))
  const shown = printing ? sorted.filter((r) => !r.isTotal) : pageOf(sorted, safePage)
  const totals = sorted.filter((r) => r.isTotal)

  // Printing renders every row; the browser's own print command (Ctrl+P) goes through the same events.
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true))
    const after = () => setPrinting(false)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])

  const onSort = useCallback((key: string) => {
    setPage(1)
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null))
  }, [])

  const exportCsv = () => {
    download(csvBlob(toCsv(result.columns, sorted, tz)), fileNameOf(result, 'csv'))
  }
  const exportXlsx = async () => {
    setBusy('xlsx')
    try {
      const { xlsxBlob } = await import('./exports/xlsx')
      download(await xlsxBlob(result, sorted, { title: info.title, filters: filterLines }), fileNameOf(result, 'xlsx'))
    } catch {
      toast.error(t.toolbar.exportFailed)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="report-print space-y-4">
      <header className="hidden print:block">
        <h1 className="text-xl font-semibold">{info.title}</h1>
        <p className="text-sm">{t.range(result.from, result.to)}{filterLines.length > 0 ? ` · ${filterLines.join(' · ')}` : ''}</p>
        <p className="text-sm">{t.generated(formatInZone(result.generatedAt, tz))}</p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h2 className="text-lg font-semibold">{info.title}</h2>
          <p className="text-sm text-slate-500">{t.range(result.from, result.to)} · {t.generated(formatInZone(result.generatedAt, tz))}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<Download aria-hidden className="size-4" />} onClick={exportCsv}>{t.toolbar.csv}</Button>
          <Button variant="secondary" size="sm" icon={<FileSpreadsheet aria-hidden className="size-4" />} loading={busy === 'xlsx'} onClick={() => void exportXlsx()}>
            {busy === 'xlsx' ? t.toolbar.exporting : t.toolbar.xlsx}
          </Button>
          <Button variant="secondary" size="sm" icon={<Printer aria-hidden className="size-4" />} onClick={() => window.print()}>{t.toolbar.print}</Button>
        </div>
      </div>

      <Tiles tiles={result.summary.tiles} />
      <Charts result={result} />

      {result.rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-surface">
          <EmptyState title={t.empty} body={t.emptyHint} />
        </div>
      ) : (
        <ReportTable
          columns={result.columns}
          rows={shown}
          totals={totals}
          total={total}
          page={safePage}
          sort={sort}
          onSort={onSort}
          onPage={setPage}
          timeZone={tz}
          caption={info.title}
          all={printing}
        />
      )}
    </div>
  )
}

