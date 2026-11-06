import type { ReactNode } from 'react'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { SearchField } from '@/components/ui/SearchField'
import { strings } from '@/lib/strings'

interface Props {
  search: string
  onSearch: (v: string) => void
  searchLabel: string
  searchPlaceholder: string
  status: string
  onStatus: (v: string) => void
  statusOptions: { value: string; label: string }[]
  /** Admin scope only. */
  contractors?: { id: string; name: string }[]
  contractorId?: string
  onContractor?: (v: string) => void
  /** More filters, shown after the status filter. */
  filters?: ReactNode
  /** Shown at the end of the row, e.g. a result count. */
  end?: ReactNode
}

export function ListToolbar({
  search,
  onSearch,
  searchLabel,
  searchPlaceholder,
  status,
  onStatus,
  statusOptions,
  contractors,
  contractorId = '',
  onContractor,
  filters,
  end,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchField label={searchLabel} placeholder={searchPlaceholder} value={search} onChange={(e) => onSearch(e.target.value)} className="basis-full sm:basis-auto" />
      {contractors && onContractor && (
        <FilterSelect label={strings.admin.createUser.contractor} value={contractorId} onChange={(e) => onContractor(e.target.value)} className="max-w-48">
          <option value="">{strings.list.allContractors}</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </FilterSelect>
      )}
      <FilterSelect label={strings.common.status} value={status} onChange={(e) => onStatus(e.target.value)}>
        <option value="">{strings.list.allStatuses}</option>
        {statusOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </FilterSelect>
      {filters}
      {end && <div className="ml-auto text-sm text-slate-500">{end}</div>}
    </div>
  )
}
