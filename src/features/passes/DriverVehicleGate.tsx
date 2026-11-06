import { useQuery } from '@tanstack/react-query'
import { Ban, CircleHelp, Lock, ScanLine, TriangleAlert, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'
import { resolveVehicle } from '@/lib/api'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import type { FormContext, PassSummary } from '@/types/passes'
import { PassStatus } from './PassStatus'
import { PreTripForm } from './PreTripForm'
import { StateScreen } from './StateScreen'
import { useOnline } from './useOnline'

const t = strings.pass.gate

/**
 * What a driver sees after scanning a vehicle QR. `resolveVehicle` decides the state on the server; this component
 * only renders it (one screen per state) and never guesses.
 */
export default function DriverVehicleGate({ vehicleId }: { vehicleId: string }) {
  const navigate = useNavigate()
  const online = useOnline()
  const { profile } = useSession()
  const [submitted, setSubmitted] = useState<{ passId: string; ctx: FormContext; at: number } | null>(null)
  const [fixing, setFixing] = useState(false)

  // Always ask the server on open, so a changed checklist or a new pass is picked up on the next scan.
  const q = useQuery({
    queryKey: ['resolveVehicle', vehicleId],
    queryFn: () => resolveVehicle({ vehicleId }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
  })
  const reload = () => {
    setSubmitted(null)
    setFixing(false)
    void q.refetch()
  }
  const home = () => void navigate('/driver', { replace: true })
  const homeButton = <Button variant="secondary" className="h-14 text-base" onClick={home}>{t.home}</Button>

  const banner = !online && (
    <p role="status" className="flex items-center justify-center gap-2 bg-accent px-4 py-2 text-sm font-semibold text-ink">
      <WifiOff aria-hidden className="size-4" /> {t.offline}
    </p>
  )

  if (submitted) {
    const summary: PassSummary = {
      passId: submitted.passId, plateNo: submitted.ctx.vehicle.plateNo, status: 'submitted',
      submittedAt: submitted.at, driverName: profile.name, mine: true,
    }
    return <PassStatus summary={summary} plateNo={summary.plateNo} onDone={home} onRejected={reload} />
  }

  if (q.isPending || q.isFetching) return <><PageSpinner />{banner}</>

  if (q.isError) {
    return (
      <>
        {banner}
        <StateScreen
          icon={online ? <TriangleAlert aria-hidden /> : <WifiOff aria-hidden />}
          title={t.loadFailed}
          body={online ? strings.common.somethingWrong : t.offline}
          action={<Button className="h-14 text-base" onClick={reload}>{t.retry}</Button>}
        />
      </>
    )
  }

  const r = q.data
  switch (r.state) {
    case 'can_submit':
      return (
        <>
          {banner}
          <PreTripForm ctx={r} onSubmitted={(s) => setSubmitted({ passId: s.passId, ctx: r, at: Date.now() })} onReload={reload} />
        </>
      )
    case 'can_resubmit':
      if (!fixing) {
        return (
          <StateScreen
            icon={<TriangleAlert aria-hidden className="text-danger-strong" />}
            title={t.rejectedTitle}
            body={`${t.rejectedReason}: ${r.rejection.reason}`}
            action={<Button className="h-14 text-base" onClick={() => setFixing(true)}>{t.fixAndResubmit}</Button>}
          />
        )
      }
      return (
        <>
          {banner}
          <PreTripForm
            ctx={r}
            rejection={{ reason: r.rejection.reason }}
            previous={r.previous.checklist}
            onSubmitted={(s) => setSubmitted({ passId: s.passId, ctx: r, at: Date.now() })}
            onReload={reload}
          />
        </>
      )
    case 'pending':
    case 'approved':
    case 'checked_in':
      return <PassStatus summary={r.pass} plateNo={r.pass.plateNo} onDone={home} doneLabel={t.home} onRejected={reload} />
    case 'rejected_locked':
      return (
        <StateScreen
          icon={<Lock aria-hidden />}
          title={t.lockedTitle}
          body={r.reason === 'other_driver' ? t.lockedOther(r.pass.driverName) : t.lockedMax}
          action={homeButton}
        />
      )
    case 'not_assigned':
      return <StateScreen icon={<ScanLine aria-hidden />} title={t.notAssignedTitle} body={t.notAssigned} action={homeButton} />
    case 'vehicle_suspended':
    case 'contractor_suspended':
      return <StateScreen icon={<Ban aria-hidden />} title={t.suspendedTitle} body={t.suspended} action={homeButton} />
    case 'not_found':
      return <StateScreen icon={<CircleHelp aria-hidden />} title={t.notFoundTitle} body={t.notFound} action={homeButton} />
  }
}
