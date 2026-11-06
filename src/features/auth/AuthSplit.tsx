import { ShieldCheck, QrCode, Truck } from 'lucide-react'
import type { ReactNode } from 'react'
import { BrandMark } from '@/components/BrandMark'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'

const highlights = [
  { icon: QrCode, text: strings.auth.pointScan },
  { icon: ShieldCheck, text: strings.auth.pointApprove },
  { icon: Truck, text: strings.auth.pointGate },
]

/**
 * Shared frame for the two sign-in screens. Below `lg` it is a single, centred column; from `lg` up a red brand panel
 * sits beside the form, so a laptop at the gate house or an office desk does not show a lonely card in a white void.
 */
export function AuthSplit({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(22rem,5fr)_7fr]">
      <aside className="hidden flex-col justify-between bg-brand p-12 text-on-solid lg:flex xl:p-16">
        <div className="flex items-center gap-3">
          <BrandMark className="size-11 rounded-xl" />
          <span className="text-xl font-semibold tracking-tight">{strings.app.name}</span>
        </div>
        <div>
          <h2 className="max-w-md text-4xl leading-tight font-bold tracking-tight">{strings.auth.heroTitle}</h2>
          <ul className="mt-10 space-y-5">
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-4 text-lg text-slate-200">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-800 text-accent">
                  <Icon aria-hidden className="size-5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-slate-400">{strings.app.tagline}</p>
      </aside>

      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-8 pb-6 sm:px-8 lg:max-w-none lg:items-center lg:justify-center lg:px-12">
        <div className={cn('flex w-full flex-1 flex-col lg:max-w-md lg:flex-none', className)}>{children}</div>
      </main>
    </div>
  )
}

/** Logo above the title on small screens; the desktop panel already carries the brand, so it hides from `lg`. */
export function AuthHeading({ title, subtitle, compact }: { title: string; subtitle?: string | undefined; compact?: boolean }) {
  return (
    <header className={cn('flex flex-col items-center text-center lg:items-start lg:text-left', compact ? 'gap-1' : 'gap-2')}>
      <BrandMark className={cn('rounded-2xl lg:hidden', compact ? 'mb-1 size-12' : 'mb-2 size-16')} />
      <h1 className={cn('font-extrabold tracking-tight text-ink', compact ? 'text-2xl sm:text-3xl' : 'text-3xl')}>{title}</h1>
      {subtitle && <p className="text-base text-slate-600">{subtitle}</p>}
    </header>
  )
}
