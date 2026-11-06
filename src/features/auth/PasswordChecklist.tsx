import { Check, Circle } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { PasswordChecks } from '@/lib/passwordRules'
import { strings } from '@/lib/strings'

const t = strings.passwordRules

/** Live list of the password rules. Each line says "done" or "not yet" to assistive technology, not just by colour. */
export function PasswordChecklist({ checks }: { checks: PasswordChecks }) {
  const rows: [keyof PasswordChecks, string][] = [
    ['length', t.length],
    ['notEmail', t.notEmail],
    ['notCommon', t.notCommon],
  ]
  return (
    <ul aria-label={t.title} data-testid="password-rules" className="space-y-1 text-sm">
      {rows.map(([key, label]) => (
        <li key={key} className={cn('flex items-center gap-2', checks[key] ? 'text-success-strong' : 'text-slate-600')} data-met={checks[key]}>
          {checks[key] ? <Check aria-hidden className="size-4 shrink-0" /> : <Circle aria-hidden className="size-4 shrink-0" />}
          <span>{label}</span>
          <span className="sr-only">{checks[key] ? t.met : t.unmet}</span>
        </li>
      ))}
    </ul>
  )
}
