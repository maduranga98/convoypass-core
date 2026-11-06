import { ShieldAlert, SearchX } from 'lucide-react'
import { Link } from 'react-router-dom'
import { strings } from '@/lib/strings'
import { OPERATOR_HOME, ROLE_HOME } from '@/lib/roles'
import { useAuth } from './useAuth'

function ErrorPage({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  const { session, operator } = useAuth()
  const to = session ? ROLE_HOME[session.claims.role] : operator ? OPERATOR_HOME : '/login'
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 text-slate-300 [&>svg]:size-12">{icon}</div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{body}</p>
        <Link
          to={to}
          className="mt-6 inline-flex h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-on-solid hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {session || operator ? strings.errorPages.goHome : strings.errorPages.signInRequired}
        </Link>
      </div>
    </main>
  )
}

export const ForbiddenPage = () => (
  <ErrorPage icon={<ShieldAlert aria-hidden />} title={strings.errorPages.forbiddenTitle} body={strings.errorPages.forbiddenBody} />
)

export const NotFoundPage = () => (
  <ErrorPage icon={<SearchX aria-hidden />} title={strings.errorPages.notFoundTitle} body={strings.errorPages.notFoundBody} />
)
