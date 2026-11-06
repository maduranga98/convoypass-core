import { QrCode, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { CheckList } from '@/components/ui/CheckList'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { FilterSelect } from '@/components/ui/FilterSelect'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { SearchField } from '@/components/ui/SearchField'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { matchesSearch } from '@/features/shared/list'
import { useContractorList, useVehicles } from '@/features/shared/queries'
import { useScope, type Scope } from '@/features/shared/scope'
import { labelsPerPage, type LabelData, type LabelSize } from './labelLayout'
import { LabelSheet } from './LabelSheet'
import { QrGate } from './QrGate'

const t = strings.qr

type Mode = 'all' | 'contractor' | 'manual'

/** Select vehicles, choose a label size, print on A4. Everything except the sheet is hidden when printing. */
export default function QrLabelsPage({ scope }: { scope: Scope }) {
  const { isAdmin } = useScope(scope)
  const vehicles = useVehicles(scope)
  const contractors = useContractorList(scope)
  const [params] = useSearchParams()
  const preselected = params.get('vehicle')

  const [mode, setMode] = useState<Mode>(preselected ? 'manual' : 'all')
  const [contractorId, setContractorId] = useState('')
  const [picked, setPicked] = useState<string[]>(preselected ? [preselected] : [])
  const [size, setSize] = useState<LabelSize>('large')
  const [search, setSearch] = useState('')

  const contractorName = useMemo(() => new Map((contractors.data ?? []).map((c) => [c.id, c.name])), [contractors.data])
  const all = useMemo(() => vehicles.data?.items ?? [], [vehicles.data])

  const selected = useMemo(() => {
    if (mode === 'manual') return all.filter((v) => picked.includes(v.id))
    const active = all.filter((v) => v.status === 'active')
    return mode === 'contractor' ? active.filter((v) => v.contractorId === contractorId) : active
  }, [all, mode, contractorId, picked])

  const labels: LabelData[] = selected.map((v) => ({
    id: v.id,
    plateNo: v.plateNo,
    contractorName: contractorName.get(v.contractorId) ?? '',
  }))

  const pickable = all.filter((v) => matchesSearch(`${v.plateNo} ${v.type}`, search))
  const modes: { value: Mode; label: string; hidden?: boolean }[] = [
    { value: 'all', label: t.selectAll },
    { value: 'contractor', label: t.selectContractor, hidden: !isAdmin },
    { value: 'manual', label: t.selectManual },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight print:hidden">{t.title}</h1>

      <QrGate>
        {(base) =>
          vehicles.isPending || contractors.isPending ? (
            <ListSkeleton rows={3} />
          ) : vehicles.isError || contractors.isError ? (
            <ErrorState error={vehicles.error ?? contractors.error} onRetry={() => void Promise.all([vehicles.refetch(), contractors.refetch()])} />
          ) : all.length === 0 ? (
            <EmptyState icon={<QrCode aria-hidden />} title={strings.vehicles.emptyTitle} body={strings.vehicles.emptyBody} />
          ) : (
            <>
              <div className="space-y-5 rounded-xl border border-slate-200 bg-surface p-4 sm:p-5 print:hidden">
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-slate-700">{t.selection}</legend>
                  <div className="flex flex-wrap gap-2">
                    {modes
                      .filter((m) => !m.hidden)
                      .map((m) => (
                        <label
                          key={m.value}
                          className={cn(
                            'inline-flex h-10 cursor-pointer items-center rounded-lg border px-3 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
                            mode === m.value ? 'border-brand bg-accent-soft text-ink' : 'border-slate-300 text-slate-700 hover:bg-slate-50',
                          )}
                        >
                          <input type="radio" name="mode" className="sr-only" checked={mode === m.value} onChange={() => setMode(m.value)} />
                          {m.label}
                        </label>
                      ))}
                  </div>
                </fieldset>

                {mode === 'contractor' && (
                  <FilterSelect label={t.contractor} value={contractorId} onChange={(e) => setContractorId(e.target.value)} className="max-w-xs">
                    <option value="">{strings.admin.createUser.contractorPlaceholder}</option>
                    {(contractors.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </FilterSelect>
                )}

                {mode === 'manual' && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <SearchField label={strings.vehicles.searchLabel} placeholder={strings.vehicles.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
                      <Button variant="secondary" size="sm" onClick={() => setPicked((p) => [...new Set([...p, ...pickable.map((v) => v.id)])])}>
                        {t.selectVisible}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setPicked([])}>
                        {t.clearSelection}
                      </Button>
                    </div>
                    <CheckList
                      legend={t.selection}
                      options={pickable.map((v) => ({
                        id: v.id,
                        label: v.plateNo,
                        hint: [v.status === 'suspended' ? strings.status.suspended : null, contractorName.get(v.contractorId)].filter(Boolean).join(' · '),
                      }))}
                      value={picked}
                      onChange={setPicked}
                      emptyText={strings.list.noMatchTitle}
                    />
                  </div>
                )}

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-slate-700">{t.size}</legend>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ['large', t.sizeLarge],
                        ['small', t.sizeSmall],
                      ] as const
                    ).map(([value, label]) => (
                      <label
                        key={value}
                        className={cn(
                          'inline-flex h-10 cursor-pointer items-center rounded-lg border px-3 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
                          size === value ? 'border-brand bg-accent-soft text-ink' : 'border-slate-300 text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        <input type="radio" name="size" className="sr-only" checked={size === value} onChange={() => setSize(value)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <p className="text-sm text-slate-500" role="status">
                    {labels.length === 0 ? t.noneSelected : `${t.labelCount(labels.length)} · ${Math.ceil(labels.length / labelsPerPage(size))} A4`}
                    {mode !== 'manual' && <span className="mt-0.5 block text-xs">{t.activeOnly}</span>}
                  </p>
                  <Button icon={<Printer aria-hidden className="size-4" />} disabled={labels.length === 0} onClick={() => window.print()}>
                    {t.print}
                  </Button>
                </div>
              </div>

              {labels.length > 0 && (
                <div className="overflow-x-auto print:overflow-visible">
                  <LabelSheet labels={labels} size={size} baseUrl={base.url} />
                </div>
              )}
            </>
          )
        }
      </QrGate>
    </div>
  )
}
