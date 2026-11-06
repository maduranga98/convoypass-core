import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { strings } from '@/lib/strings'

/** Public placeholder: the organisation publishes its own policy here (see docs/privacy-notes.md for the facts to base it on). */
export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-10">
      <Link to="/login" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-700 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
        <ArrowLeft aria-hidden className="size-4" />
        {strings.userSettings.back}
      </Link>
      <h1 className="pt-2 text-2xl font-semibold tracking-tight">{strings.privacy.title}</h1>
      <p className="pt-3 text-base text-slate-700">{strings.privacy.placeholder}</p>
    </main>
  )
}
