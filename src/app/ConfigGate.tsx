import type { ReactNode } from 'react'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { missingFirebaseConfig } from '@/lib/firebase'
import { strings } from '@/lib/strings'

/** A build without Firebase settings fails every request in confusing ways; say so on the first screen instead. */
export function ConfigGate({ children }: { children: ReactNode }) {
  if (missingFirebaseConfig.length === 0) return <>{children}</>
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-4">
      <NotificationBanner tone="error" title="ConvoyPass can't start" className="w-full">
        <p>{strings.loadErrors.missingConfig}</p>
        <p className="mt-1 font-mono text-xs">{strings.loadErrors.missingConfigKeys(missingFirebaseConfig.join(', '))}</p>
      </NotificationBanner>
    </main>
  )
}
