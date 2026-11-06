import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useSession } from '@/features/auth/useAuth'
import { strings } from '@/lib/strings'
import { OnboardingCard } from './OnboardingCard'

/** Top of the admin dashboard: the welcome toast (`?welcome=1`, removed straight away) and the checklist card. */
export function OnboardingGate() {
  const { claims } = useSession()
  const [params, setParams] = useSearchParams()
  const welcomed = useRef(false)
  const welcome = params.get('welcome') === '1'

  useEffect(() => {
    if (!welcome || welcomed.current) return
    welcomed.current = true
    toast.success(strings.onboarding.welcome)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('welcome')
        return next
      },
      { replace: true },
    )
  }, [welcome, setParams])

  if (claims.role !== 'admin') return null
  return <OnboardingCard tenantId={claims.tenantId} />
}
