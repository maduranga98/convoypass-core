import { Modal } from '@/components/ui/Modal'
import { EligibilityBadge } from '@/components/ui/EligibilityBadge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatPhone } from '@/lib/credentials'
import { strings } from '@/lib/strings'
import { useBlocked } from '@/features/penalties/feed'
import { GatePassSection } from '@/features/gatePasses/GatePassSection'
import { BlockedBadge } from '@/features/penalties/PenaltyBadges'
import { PenaltyHistory } from '@/features/penalties/PenaltyHistory'
import { DriverRequirements } from '@/features/qualifications/DriverRequirements'
import { VisitHistory } from '@/features/visits/VisitHistory'
import { ExpiryRow } from '@/features/shared/ExpiryRow'
import type { Scope } from '@/features/shared/scope'
import type { Driver, WithId } from '@/types'
import { DriverAvatar } from './DriverAvatar'

const t = strings.drivers

interface Props {
  scope: Scope
  driver: WithId<Driver> | null
  contractorName: string | undefined
  onClose: () => void
}

/** Driver detail: contact, licence status and the full penalty history (active, expired and revoked). */
export function DriverDrawer({ scope, driver, contractorName, onClose }: Props) {
  return (
    <Modal open={driver !== null} onClose={onClose} title={driver?.name ?? ''} variant="drawer">
      {driver && <Body scope={scope} driver={driver} contractorName={contractorName} />}
    </Modal>
  )
}

function Body({ scope, driver, contractorName }: { scope: Scope; driver: WithId<Driver>; contractorName: string | undefined }) {
  const blocked = useBlocked(scope)
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <DriverAvatar driver={driver} className="size-16 text-base" />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={driver.status} />
          {blocked.drivers.has(driver.id) && <BlockedBadge />}
          {contractorName && scope === 'admin' && <span className="text-sm text-slate-500">· {contractorName}</span>}
        </div>
      </div>

      <dl className="space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-slate-500">{t.detail.phone}</dt>
          <dd className="font-mono font-medium text-slate-900">{driver.phone ? formatPhone(driver.phone) : strings.common.none}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-slate-500">{t.detail.licenseNo}</dt>
          <dd className="font-medium text-slate-900">{driver.licenseNo || strings.common.none}</dd>
        </div>
      </dl>

      <section className="space-y-3 border-t border-slate-100 pt-5" aria-label={t.detail.documents}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t.detail.documents}</h3>
          <EligibilityBadge status={driver.eligibilityStatus} />
        </div>
        <dl className="space-y-1.5 text-sm">
          <ExpiryRow label={strings.eligibility.license} date={driver.licenseExpiry} />
        </dl>
      </section>

      <DriverRequirements driver={driver} />

      <GatePassSection scope={scope} field="driverId" id={driver.id} overviewPath={scope === 'admin' ? '/admin/gate-passes' : undefined} />

      <PenaltyHistory scope={scope} driverId={driver.id} />
      <VisitHistory scope={scope} field="driverId" id={driver.id} />
    </div>
  )
}
