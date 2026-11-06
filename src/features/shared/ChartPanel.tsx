import { BarChart3, Table2 } from 'lucide-react'
import { Component, Suspense, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { strings } from '@/lib/strings'

/** A lazy chart that fails to load (offline, old cache) must not take the page down: the table is always there. */
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override render(): ReactNode {
    return this.state.failed ? (
      <p role="status" className="rounded-lg bg-slate-100 px-3 py-6 text-center text-sm text-slate-600">{strings.reports.chart.unavailable}</p>
    ) : (
      this.props.children
    )
  }
}

/**
 * A chart and its table version. Meaning never depends on the chart alone: the toggle swaps in the same numbers as a
 * table, and the chart itself has a text description. Print always shows the table.
 */
export function ChartPanel({ title, label, chart, table, startAsTable = false, actions }: {
  title: string
  /** Text description of the chart for screen readers. */
  label: string
  chart: ReactNode
  table: ReactNode
  startAsTable?: boolean
  actions?: ReactNode
}) {
  const [asTable, setAsTable] = useState(startAsTable)
  const t = strings.reports.chart
  return (
    <section aria-label={title} className="space-y-3 rounded-xl border border-slate-200 bg-surface p-4 print:break-inside-avoid">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          {actions}
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={asTable}
            icon={asTable ? <BarChart3 aria-hidden className="size-4" /> : <Table2 aria-hidden className="size-4" />}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? t.show : t.table}
          </Button>
        </div>
      </div>
      <h2 className="hidden text-base font-semibold print:block">{title}</h2>
      {asTable ? (
        <div data-testid="chart-table">{table}</div>
      ) : (
        <div role="img" aria-label={label} className="h-64 w-full print:hidden">
          <ChartBoundary>
            <Suspense fallback={<Skeleton className="h-full w-full" />}>{chart}</Suspense>
          </ChartBoundary>
        </div>
      )}
      {!asTable && <div className="hidden print:block">{table}</div>}
    </section>
  )
}
