import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Skeleton } from '@/components/ui/Skeleton'
import { useSession } from '@/features/auth/useAuth'
import { useToday } from '@/features/passes/useToday'
import { useContractorList, useDrivers, useVehicles } from '@/features/shared/queries'
import { runReport } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { FilterBar } from './FilterBar'
import { filterProblem, parseFilters, toParams, toRequest, type ReportFilters } from './filters'
import { ReportPicker } from './ReportPicker'
import { ReportView } from './ReportView'
import type { ReportType } from '@/types/reports'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.reports

const toDay = (key: string): string => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`

/** Adds an A4 landscape `@page` rule while a report is on screen, so Print / Save as PDF is landscape. */
function usePrintPage(): void {
  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.reportPrint = 'true'
    style.textContent = '@page { size: A4 landscape; margin: 10mm }'
    document.head.appendChild(style)
    return () => style.remove()
  }, [])
}

/** Human readable filter lines (contractor, vehicle, driver) for the XLSX summary and the print header. */
function useFilterLines(f: ReportFilters | null): string[] {
  const contractors = useContractorList('admin')
  const vehicles = useVehicles('admin', { enabled: f?.type === 'vehicle_history' })
  const drivers = useDrivers('admin', { enabled: f?.type === 'driver_history' })
  return useMemo(() => {
    if (!f) return []
    const lines: string[] = []
    if (f.contractorId) lines.push(`${t.filters.contractor}: ${contractors.data?.find((c) => c.id === f.contractorId)?.name ?? f.contractorId}`)
    if (f.type === 'vehicle_history' && f.vehicleId) lines.push(`${t.filters.vehicle}: ${vehicles.data?.items.find((v) => v.id === f.vehicleId)?.plateNo ?? f.vehicleId}`)
    if (f.type === 'driver_history' && f.driverId) lines.push(`${t.filters.driver}: ${drivers.data?.items.find((d) => d.id === f.driverId)?.name ?? f.driverId}`)
    return lines
  }, [f, contractors.data, vehicles.data, drivers.data])
}

/**
 * `/admin/reports` and `/officer/reports`. The applied filters are the URL: any view is linkable and a refresh gives
 * the same report. The filter bar edits a draft and only Apply changes the URL, so nothing runs per keystroke.
 */
export default function ReportsPage() {
  usePrintPage()
  const { claims } = useSession()
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const todayDay = today ? toDay(today) : null
  const filters = useMemo(() => (todayDay ? parseFilters(params, todayDay) : null), [params, todayDay])
  const problem = filters ? filterProblem(filters) : null
  const request = filters && !problem ? toRequest(filters) : null
  const lines = useFilterLines(filters)

  const report = useQuery({
    queryKey: ['report', claims.tenantId, request],
    enabled: request !== null,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => runReport(request as NonNullable<typeof request>),
  })

  if (!todayDay) return <PageSpinner />

  const pick = (type: ReportType) => {
    const base = filters ?? parseFilters(new URLSearchParams({ type }), todayDay)
    if (!base) return
    setParams(toParams({ ...base, type, vehicleId: '', driverId: '' }), { replace: false })
  }

  return (
    <div className={`space-y-6 ${claims.role === 'officer' ? 'px-4 py-5 sm:px-6 lg:px-8 lg:py-8' : ''}`}>
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
      </div>

      <ReportPicker current={filters?.type ?? null} onPick={pick} />

      {filters && (
        // Keyed by the applied filters: browser back/forward and the presets reset the draft.
        <FilterBar key={params.toString()} applied={filters} today={todayDay} onApply={(f) => setParams(toParams(f))} />
      )}

      {!filters ? null : problem === 'need-vehicle' || problem === 'need-driver' ? (
        <p role="status" className="rounded-xl border border-dashed border-slate-300 bg-surface px-4 py-8 text-center text-sm text-slate-500">
          {problem === 'need-vehicle' ? t.filters.needVehicle : t.filters.needDriver}
        </p>
      ) : problem ? (
        <NotificationBanner tone="error">{problem === 'range-long' ? t.filters.maxRange : t.filters.orderError}</NotificationBanner>
      ) : report.isPending ? (
        <div role="status" aria-busy="true" className="space-y-3">
          <span className="sr-only">{t.running}</span>
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : report.isError ? (
        <ErrorState message={apiErrorMessage(report.error)} error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <ReportView result={report.data} filterLines={lines} />
      )}
    </div>
  )
}
