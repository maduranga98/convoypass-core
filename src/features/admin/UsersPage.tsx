import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, LockKeyholeOpen, Pencil, Plus, UserCheck, UserX, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input, Select } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { updateUser } from '@/lib/api'
import { formatPhone } from '@/lib/credentials'
import { apiErrorMessage } from '@/lib/errors'
import { ROLES, type Role } from '@/lib/roles'
import { strings } from '@/lib/strings'
import type { UserDoc, UserStatus, WithId } from '@/types'
import { useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'
import { isPinRole } from '@/lib/session'
import { LastSignIn } from './LastSignIn'
import { ReissuePinDialog, type ReissueTarget } from './ReissuePinDialog'
import { useShowPin } from './ShowPinDialog'
import { CreateUserDrawer } from './CreateUserDrawer'
import { EditUserModal } from './EditUserModal'
import { ResetCredentialModal } from './ResetCredentialModal'
import { useContractors, useUsers } from './queries'

const t = strings.admin.users

export default function UsersPage() {
  const { uid, claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const queryClient = useQueryClient()
  const [role, setRole] = useState<Role | ''>('')
  const [status, setStatus] = useState<UserStatus | ''>('')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<WithId<UserDoc> | null>(null)
  const [resetting, setResetting] = useState<WithId<UserDoc> | null>(null)
  const [reissuing, setReissuing] = useState<ReissueTarget | null>(null)
  const [showPin, showPinModal] = useShowPin()
  const [toggling, setToggling] = useState<WithId<UserDoc> | null>(null)

  const users = useUsers(role)
  const contractors = useContractors()
  const contractorNames = useMemo(
    () => new Map((contractors.data ?? []).map((c) => [c.id, c.name])),
    [contractors.data],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return (users.data ?? []).filter((u) => {
      if (status && u.status !== status) return false
      if (!q) return true
      return (
        u.name.toLowerCase().includes(q) ||
        (u.email?.toLowerCase().includes(q) ?? false) ||
        (digits.length > 0 && u.phone !== null && (u.phone.includes(digits.replace(/^0/, '94')) || u.phone.includes(digits)))
      )
    })
  }, [users.data, status, search])

  const toggle = useMutation({
    mutationFn: (u: WithId<UserDoc>) =>
      updateUser({ uid: u.id, status: u.status === 'active' ? 'disabled' : 'active' }),
    onSuccess: async (_d, u) => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(u.status === 'active' ? strings.admin.toggle.disabled : strings.admin.toggle.enabled)
      setToggling(null)
    },
    onError: (e) => {
      toast.error(apiErrorMessage(e))
      setToggling(null)
    },
  })

  const columns: Column<WithId<UserDoc>>[] = [
    {
      key: 'name',
      header: t.columns.name,
      primary: true,
      cell: (u) => (
        <div>
          <span className="font-medium text-ink">{u.name}</span>
          {isPinRole(u.role) ? (
            <p className="text-xs font-normal text-slate-600">{t.pinSignIn}</p>
          ) : (
            u.mustChangePassword && <p className="text-xs font-normal text-slate-600">{t.mustChange}</p>
          )}
        </div>
      ),
    },
    { key: 'role', header: t.columns.role, cell: (u) => strings.roles[u.role] },
    {
      key: 'login',
      header: t.columns.login,
      cell: (u) => u.email ?? (u.phone ? formatPhone(u.phone) : strings.common.none),
    },
    {
      key: 'contractor',
      header: t.columns.contractor,
      cell: (u) => (u.contractorId ? (contractorNames.get(u.contractorId) ?? strings.common.none) : strings.common.none),
    },
    {
      key: 'lastSignIn',
      header: t.columns.lastSignIn,
      cell: (u) => (isPinRole(u.role) ? <LastSignIn user={u} /> : strings.common.none),
    },
    {
      key: 'status',
      header: t.columns.status,
      cell: (u) => <Badge tone={u.status === 'active' ? 'success' : 'danger'}>{strings.status[u.status]}</Badge>,
    },
  ]

  const actions = (u: WithId<UserDoc>) => {
    // Admin accounts are managed by the platform super admin: no edit, reset or disable here (the functions refuse too).
    if (u.role === 'admin') return <Badge tone="neutral">{t.managedBy}</Badge>
    const isSelf = u.id === uid
    const pin = isPinRole(u.role)
    const resetLabel = pin ? strings.reissue.action : strings.admin.reset.resetPassword
    const company = u.contractorId ? (contractorNames.get(u.contractorId) ?? '') : (tenant.data?.name ?? '')
    const toggleLabel = u.status === 'active' ? strings.admin.toggle.disable : strings.admin.toggle.enable
    return (
      <div className="inline-flex gap-1">
        <Button variant="ghost" size="icon" title={strings.common.edit} aria-label={`${strings.common.edit}: ${u.name}`} onClick={() => setEditing(u)}>
          <Pencil aria-hidden className="size-4" />
        </Button>
        {!isSelf && (
          <>
            {pin && (
              <Button variant="ghost" size="icon" title={strings.reissue.show} aria-label={`${strings.reissue.show}: ${u.name}`} onClick={() => void showPin({ id: u.id, name: u.name, role: u.role, company })}>
                <LockKeyholeOpen aria-hidden className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" title={resetLabel} aria-label={`${resetLabel}: ${u.name}`} onClick={() => (pin ? setReissuing({ id: u.id, name: u.name, role: u.role, company }) : setResetting(u))}>
              <KeyRound aria-hidden className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" title={toggleLabel} aria-label={`${toggleLabel}: ${u.name}`} onClick={() => setToggling(u)}>
              {u.status === 'active' ? <UserX aria-hidden className="size-4" /> : <UserCheck aria-hidden className="size-4" />}
            </Button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          {users.data && <p className="mt-1 text-sm text-slate-500">{t.count(rows.length)}</p>}
          <p className="mt-1 text-sm text-slate-500">{t.adminNote}</p>
        </div>
        <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setCreateOpen(true)}>
          {t.create}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_10rem_10rem]">
        <div className="col-span-2 sm:col-span-1">
          <Input
            label={t.searchLabel}
            type="search"
            placeholder={t.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select label={t.roleFilter} value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
          <option value="">{strings.common.all}</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {strings.roles[r]}
            </option>
          ))}
        </Select>
        <Select label={t.statusFilter} value={status} onChange={(e) => setStatus(e.target.value as UserStatus | '')}>
          <option value="">{strings.common.all}</option>
          <option value="active">{strings.status.active}</option>
          <option value="disabled">{strings.status.disabled}</option>
        </Select>
      </div>

      {users.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Users aria-hidden />} title={t.emptyTitle} body={t.emptyBody} />
      ) : (
        <DataTable caption={t.title} columns={columns} rows={rows} rowKey={(u) => u.id} actions={actions} />
      )}

      <CreateUserDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
      <EditUserModal user={editing} onClose={() => setEditing(null)} />
      <ResetCredentialModal user={resetting} onClose={() => setResetting(null)} />
      <ReissuePinDialog target={reissuing} onClose={() => setReissuing(null)} />
      {showPinModal}
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.status === 'active' ? strings.admin.toggle.disableTitle : strings.admin.toggle.enableTitle}
        body={
          toggling
            ? toggling.status === 'active'
              ? strings.admin.toggle.disableBody(toggling.name)
              : strings.admin.toggle.enableBody(toggling.name)
            : ''
        }
        confirmLabel={toggling?.status === 'active' ? strings.admin.toggle.disable : strings.admin.toggle.enable}
        tone={toggling?.status === 'active' ? 'danger' : 'primary'}
        loading={toggle.isPending}
        onConfirm={() => toggling && toggle.mutate(toggling)}
        onCancel={() => setToggling(null)}
      />
    </div>
  )
}

