import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'

export const fieldClass =
  'block w-full rounded-lg border bg-surface px-3 text-base text-ink placeholder:text-slate-500 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus disabled:bg-slate-50 disabled:text-slate-500'

interface FieldProps {
  label: string
  error?: string | undefined
  hint?: string | undefined
  optional?: boolean
}

function FieldShell({
  id,
  label,
  error,
  hint,
  optional,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between text-sm font-medium text-slate-700">
        <span>{label}</span>
        {optional && <span className="text-xs font-normal text-slate-600">{strings.common.optional}</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

interface InputProps extends Omit<ComponentProps<'input'>, 'id'>, FieldProps {
  trailing?: ReactNode
}

export function Input({ label, error, hint, optional, trailing, className, ...rest }: InputProps) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional}>
      <div className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            fieldClass,
            'h-11',
            error ? 'border-danger' : 'border-slate-300',
            trailing ? 'pr-11' : '',
            className,
          )}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
    </FieldShell>
  )
}

interface SelectProps extends Omit<ComponentProps<'select'>, 'id'>, FieldProps {}

export function Select({ label, error, hint, optional, className, children, ...rest }: SelectProps) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(fieldClass, 'h-11', error ? 'border-danger' : 'border-slate-300', className)}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  )
}

interface TextareaProps extends Omit<ComponentProps<'textarea'>, 'id'>, FieldProps {}

export function Textarea({ label, error, hint, optional, className, ...rest }: TextareaProps) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional}>
      <textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(fieldClass, 'min-h-20 resize-y py-2', error ? 'border-danger' : 'border-slate-300', className)}
        {...rest}
      />
    </FieldShell>
  )
}
