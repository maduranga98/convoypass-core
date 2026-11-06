import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { strings } from '@/lib/strings'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

export function CapNotice({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <NotificationBanner tone="warning">{strings.list.capNotice(1000)}</NotificationBanner>
  )
}

export function ShowMore({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  return (
    <div className="flex justify-center pt-1">
      <Button variant="secondary" onClick={onClick}>
        {strings.list.showMore(remaining)}
      </Button>
    </div>
  )
}

export function ClearFilters({ onClick }: { onClick: () => void }): ReactNode {
  return (
    <Button variant="secondary" onClick={onClick}>
      {strings.list.clearFilters}
    </Button>
  )
}
