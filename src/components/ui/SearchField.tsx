import { Search } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { fieldClass } from './Input'

export function SearchField({ label, className, ...rest }: Omit<ComponentProps<'input'>, 'type'> & { label: string }) {
  return (
    <div className={cn('relative min-w-0 flex-1 sm:max-w-xs', className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
      <input type="search" aria-label={label} autoComplete="off" className={cn(fieldClass, 'h-11 border-slate-300 pl-9 text-sm')} {...rest} />
    </div>
  )
}
