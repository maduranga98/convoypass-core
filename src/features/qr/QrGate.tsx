import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { EmptyState } from '@/components/ui/EmptyState'
import { appBase, type AppBase } from '@/lib/appUrl'
import { strings } from '@/lib/strings'

/** Red banner shown on every QR screen when the base URL is not the production domain. */
export function DevLinkBanner({ base }: { base: AppBase }) {
  if (!base.isDevLink) return null
  return (
    <div role="alert" className="rounded-lg border border-danger-hover bg-danger-strong px-4 py-3 text-on-solid print:hidden">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <TriangleAlert aria-hidden className="size-4 shrink-0" />
        {strings.qr.devBanner}
      </p>
      <p className="mt-1 break-all text-xs text-on-solid">{strings.qr.devBannerBody(base.url)}</p>
    </div>
  )
}

/** Every QR screen renders through this: it refuses to show QR codes without VITE_APP_BASE_URL and adds the dev banner. */
export function QrGate({ children }: { children: (base: AppBase) => ReactNode }) {
  if (!appBase) {
    return (
      <EmptyState icon={<TriangleAlert aria-hidden />} title={strings.qr.missingBase} body={strings.qr.missingBaseBody} />
    )
  }
  return (
    <>
      <DevLinkBanner base={appBase} />
      {children(appBase)}
    </>
  )
}
