import { strings } from '@/lib/strings'
import { describeLoadError } from '@/lib/errors'
import { Button } from './Button'
import { NotificationBanner } from './NotificationBanner'

/**
 * A list or page that could not load. Shows the reason when the error says (rules not deployed, index missing,
 * offline), so "no data" is never a mystery. Pass the query's `error` to get the reason.
 */
export function ErrorState({ message = strings.common.loadFailed, error, onRetry }: { message?: string; error?: unknown; onRetry?: () => void }) {
  const reason = describeLoadError(error)
  return (
    <div className="px-4 py-8 sm:px-6">
      <NotificationBanner
        tone="error"
        title={message}
        action={onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>{strings.common.retry}</Button>}
        className="mx-auto max-w-xl"
      >
        {reason}
      </NotificationBanner>
    </div>
  )
}
