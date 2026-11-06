import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { fieldClass } from './Input'

// `cn` does not merge conflicting utilities, so the shared field class is used without its `w-full`.
const compact = fieldClass.replace('w-full', 'w-auto')

/** Compact select for list toolbars. The label is announced but not shown. */
export function FilterSelect({ label, className, children, ...rest }: ComponentProps<'select'> & { label: string }) {
  return (
    <select aria-label={label} className={cn(compact, 'h-11 border-slate-300 text-sm', className)} {...rest}>
      {children}
    </select>
  )
}
