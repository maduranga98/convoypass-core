import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { strings } from '@/lib/strings'
import { useReinspectionVehicles } from './queries'

const t = strings.inspections.list

/** Safety Officer home: how many vehicles need another look, with a way in. Shows nothing while there are none (or it cannot load). */
export function ReinspectionCallout() {
  const navigate = useNavigate()
  const count = useReinspectionVehicles().data?.length ?? 0
  if (count === 0) return null
  return (
    <NotificationBanner
      tone="warning"
      action={
        <Button variant="secondary" size="sm" onClick={() => navigate('/safety/reinspection')}>
          {t.calloutAction}
        </Button>
      }
    >
      {t.callout(count)}
    </NotificationBanner>
  )
}
