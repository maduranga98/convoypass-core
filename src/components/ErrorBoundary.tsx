import { TriangleAlert } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logClientError, type ErrorSource } from '@/lib/clientErrors'
import { strings } from '@/lib/strings'

export type BoundaryVariant = 'app' | 'gate' | 'form'

interface Props {
  variant?: BoundaryVariant
  children: ReactNode
}
interface State {
  error: Error | null
}

const SOURCE: Record<BoundaryVariant, ErrorSource> = { app: 'boundary', gate: 'gate', form: 'form' }
const t = strings.errorBoundary

/** Friendly full-screen fallback with a Reload button. `gate` and `form` variants are placed around those screens. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logClientError(Object.assign(error, { stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}` }), SOURCE[this.props.variant ?? 'app'])
  }

  render() {
    if (!this.state.error) return this.props.children
    return <ErrorFallback variant={this.props.variant ?? 'app'} />
  }
}

/** The full-screen "something went wrong" page with a Reload button (and a way back to the gate for guards). */
export function ErrorFallback({ variant = 'app' }: { variant?: BoundaryVariant }) {
  const [title, body] = variant === 'gate' ? [t.gateTitle, t.gateBody] : variant === 'form' ? [t.formTitle, t.formBody] : [t.title, t.body]
  return (
    <div role="alert" className="grid min-h-dvh place-items-center bg-slate-50 px-6 py-10">
      <div className="w-full max-w-sm space-y-4 text-center">
        <TriangleAlert aria-hidden className="mx-auto size-10 text-warning" />
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-base text-slate-700">{body}</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-12 items-center justify-center rounded-lg bg-brand px-4 text-base font-medium text-on-solid hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t.reload}
          </button>
          {variant === 'gate' && (
            <a
              href="/security"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-slate-300 bg-surface px-4 text-base font-medium text-ink hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {t.gateHome}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
