import { Radio } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { useSession } from '@/features/auth/useAuth'
import { OnboardingGate } from '@/features/onboarding/OnboardingGate'
import { formatTime } from '@/features/passes/passView'
import { useTenant } from '@/features/passes/queries'
import { useOnline } from '@/features/passes/useOnline'
import { useNow, useToday } from '@/features/passes/useToday'
import { useContractorList } from '@/features/shared/queries'
import { slaOf } from '@/lib/defaultSla'
import { strings } from '@/lib/strings'
import { AttentionPanel } from './AttentionPanel'
import { ContractorsTable } from './ContractorsTable'
import { TODAY_CAP, useTodayGateEvents, useTodayPasses } from './hooks'
import { KpiTiles } from './KpiTiles'
import type { DashboardScope } from './links'
import { attentionItems, computeKpis, contractorRows, recentGateActivity } from './model'
import { RecentGateActivity } from './RecentGateActivity'
import { TrendCard } from './TrendCard'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.dashboard

/** `/admin/dashboard` and `/officer/overview`: the same read-only screen, live for today and computed for history. */
export default function DashboardPage({ scope }: { scope: DashboardScope }) {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const today = useToday()
  const now = useNow(30_000)
  const online = useOnline()
  const passes = useTodayPasses()
  const events = useTodayGateEvents()
  const contractors = useContractorList('admin')

  const nameOf = useMemo(() => {
    const names = new Map((contractors.data ?? []).map((c) => [c.id, c.name]))
    return (id: string) => names.get(id) ?? strings.common.none
  }, [contractors.data])

  const sla = slaOf(tenant.data)
  const loading = passes.isLoading && passes.items.length === 0
  const kpis = loading ? null : computeKpis(passes.items)
  const attention = useMemo(() => attentionItems(passes.items, now, sla), [passes.items, now, sla.supervisorMinutes, sla.officerMinutes]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => contractorRows(passes.items, nameOf), [passes.items, nameOf])
  const recent = useMemo(() => recentGateActivity(passes.items, events.items), [passes.items, events.items])
  const live = passes.updatedAt !== null && !passes.isError && online

  return (
    <div className={scope === 'officer' ? 'space-y-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-8' : 'space-y-6'}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
        </div>
        <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
          <Radio aria-hidden className={`size-4 ${live ? 'text-success' : 'text-slate-500'}`} />
          <span className="font-medium">{live ? t.live : t.offline}</span>
          {passes.updatedAt !== null && <span className="text-slate-500">· {t.updated(formatTime(passes.updatedAt))}</span>}
        </p>
      </div>

      {scope === 'admin' && <OnboardingGate />}

      {passes.isError && passes.items.length === 0 ? (
        <ErrorState message={t.loadFailed} error={passes.error} onRetry={passes.retry} />
      ) : (
        <>
          {passes.capped && <NotificationBanner tone="warning" role="note">{t.capNotice(TODAY_CAP)}</NotificationBanner>}
          {passes.isError && (
            <NotificationBanner tone="error" action={<Button variant="secondary" size="sm" onClick={passes.retry}>{strings.common.retry}</Button>}>
              {t.loadFailed}
            </NotificationBanner>
          )}
          <KpiTiles kpis={kpis} scope={scope} today={today} />
          <div className="grid gap-6 xl:grid-cols-2">
            <AttentionPanel items={attention} denied={events.items.length} loading={loading || events.isLoading} scope={scope} today={today} contractorName={nameOf} />
            <ContractorsTable rows={rows} loading={loading} />
          </div>
          <TrendCard />
          <RecentGateActivity items={recent} loading={loading || events.isLoading} contractorName={nameOf} />
        </>
      )}
    </div>
  )
}
