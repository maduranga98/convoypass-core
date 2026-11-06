import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowLeft, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { addTenantAdmin, getWorkspace, resetTenantAdminCredential, setTenantAdminStatus, updateTenantAdmin } from '@/lib/api'
import { apiErrorMessage, apiErrorReason } from '@/lib/errors'
import { strings } from '@/lib/strings'
import type { WorkspaceAdmin } from '@/types/platform'
import { CredentialsCard, type CredentialsView } from './CredentialsCard'
import { ReauthCancelled } from './reauth'
import { useReauthRetry } from './useReauthRetry'
import { useSensitiveState } from './sensitive'
import { WORKSPACES_KEY } from './queryKeys'

const t = strings.platform.detail
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const fmt = (ms: number) => format(new Date(ms), 'd MMM yyyy HH:mm')

function AddAdminForm({ onSubmit, onCancel }: { onSubmit: (name: string, email: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    const m = email.trim().toLowerCase()
    const next: typeof errors = {}
    if (n.length < 2 || n.length > 60) next.name = strings.platform.workspaces.nameInvalid
    if (!EMAIL.test(m)) next.email = strings.platform.workspaces.emailInvalid
    setErrors(next)
    if (next.name || next.email) return
    setBusy(true)
    try {
      await onSubmit(n, m)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form noValidate onSubmit={(e) => void submit(e)} aria-label={t.addAdminTitle} className="space-y-4 rounded-xl border border-slate-200 bg-surface p-5">
      <div>
        <h3 className="text-base font-semibold">{t.addAdminTitle}</h3>
        <p className="text-sm text-slate-500">{t.addAdminIntro}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={strings.platform.workspaces.adminName} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="off" />
        <Input label={strings.platform.workspaces.adminEmail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoComplete="off" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>{t.addAdmin}</Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>{strings.common.cancel}</Button>
      </div>
    </form>
  )
}

function EditNameModal({ admin, onSave, onClose }: { admin: WorkspaceAdmin | null; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // Re-seed the field each time the modal opens for an admin.
  const [seed, setSeed] = useState<string | null>(null)
  if (admin && seed !== admin.uid) {
    setSeed(admin.uid)
    setName(admin.name)
  }
  if (!admin && seed !== null) setSeed(null)
  const valid = name.trim().length >= 2 && name.trim().length <= 60
  return (
    <Modal open={admin !== null} onClose={onClose} title={t.editTitle}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          setBusy(true)
          void onSave(name.trim()).finally(() => setBusy(false))
        }}
        className="space-y-4"
      >
        <Input label={t.editName} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{strings.common.cancel}</Button>
          <Button type="submit" loading={busy} disabled={!valid}>{t.save}</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function WorkspaceDetailPage() {
  const { tenantId = '' } = useParams()
  const qc = useQueryClient()
  const { run, dialog } = useReauthRetry()
  const key = ['platform', 'workspace', tenantId] as const
  const q = useQuery({ queryKey: key, queryFn: () => getWorkspace({ tenantId }), staleTime: 0, retry: false })

  // The temporary password exists only in this state: dropped on "I've shared it" or when the page is left.
  const [creds, setCreds] = useState<{ title: string; view: CredentialsView } | null>(null)
  useSensitiveState(() => setCreds(null))
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<WorkspaceAdmin | null>(null)
  const [resetting, setResetting] = useState<WorkspaceAdmin | null>(null)
  const [toggling, setToggling] = useState<WorkspaceAdmin | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key })
    void qc.invalidateQueries({ queryKey: WORKSPACES_KEY })
  }
  const company = q.data?.tenant.name ?? ''

  const add = async (name: string, email: string) => {
    try {
      const res = await run(() => addTenantAdmin({ tenantId, name, email }))
      setCreds({ title: t.addAdminTitle, view: { company, loginUrl: res.loginUrl, email, tempPassword: res.tempPassword } })
      setAdding(false)
      refresh()
    } catch (e) {
      if (!(e instanceof ReauthCancelled)) toast.error(apiErrorMessage(e))
    }
  }
  const rename = async (name: string) => {
    if (!editing) return
    try {
      await run(() => updateTenantAdmin({ tenantId, uid: editing.uid, name }))
      toast.success(t.saved)
      setEditing(null)
      refresh()
    } catch (e) {
      if (e instanceof ReauthCancelled) return
      toast.error(apiErrorMessage(e))
    }
  }
  const reset = async () => {
    if (!resetting) return
    setBusy(true)
    try {
      const res = await run(() => resetTenantAdminCredential({ tenantId, uid: resetting.uid }))
      setCreds({ title: t.reset, view: { company, loginUrl: res.loginUrl, email: resetting.email, tempPassword: res.tempPassword } })
      refresh()
    } catch (e) {
      if (!(e instanceof ReauthCancelled)) toast.error(apiErrorMessage(e))
    } finally {
      setBusy(false)
      setResetting(null)
    }
  }
  const toggle = async () => {
    if (!toggling) return
    setBusy(true)
    setDialogError(null)
    const status = toggling.status === 'active' ? 'disabled' : 'active'
    try {
      await run(() => setTenantAdminStatus({ tenantId, uid: toggling.uid, status }))
      toast.success(status === 'disabled' ? t.disabled : t.enabled)
      setToggling(null)
      refresh()
    } catch (e) {
      if (e instanceof ReauthCancelled) setToggling(null)
      // The server's message (for example the last active admin) stays in the dialog.
      else setDialogError(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const locked = creds !== null
  const columns: Column<WorkspaceAdmin>[] = [
    { key: 'name', header: t.columns.name, primary: true, cell: (a) => <span className="font-medium text-ink">{a.name}</span> },
    { key: 'email', header: t.columns.email, cell: (a) => a.email },
    { key: 'status', header: t.columns.status, cell: (a) => <Badge tone={a.status === 'active' ? 'success' : 'danger'}>{strings.status[a.status]}</Badge> },
    {
      key: 'first',
      header: t.columns.firstSignIn,
      cell: (a) => (a.lastSignInAt === null ? <Badge tone="neutral">{t.notSignedIn}</Badge> : <><Badge tone="success">{t.signedIn}</Badge>{a.mustChangePassword && <span className="mt-1 block text-xs text-slate-600">{t.mustChange}</span>}</>),
    },
    { key: 'last', header: t.columns.lastSignIn, cell: (a) => (a.lastSignInAt === null ? t.never : fmt(a.lastSignInAt)) },
  ]

  return (
    <div className="space-y-6">
      <Link to="/platform/workspaces" className="inline-flex items-center gap-1 text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus">
        <ArrowLeft aria-hidden className="size-4" />
        {strings.platform.workspaces.back}
      </Link>

      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        apiErrorReason(q.error) === 'workspace-not-found' ? <EmptyState title={t.notFound} /> : <ErrorState message={t.loadFailed} error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <header className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">{q.data.tenant.name}</h1>
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div><dt className="text-slate-500">{t.created}</dt><dd>{format(new Date(q.data.tenant.createdAt), 'd MMM yyyy')}</dd></div>
              <div><dt className="text-slate-500">{t.timezone}</dt><dd>{q.data.tenant.timezone}</dd></div>
              <div><dt className="text-slate-500">{t.users} ({t.countsOnly.toLowerCase()})</dt><dd className="tabular-nums">{q.data.tenant.userCount}</dd></div>
              <div><dt className="text-slate-500">{t.vehicles} ({t.countsOnly.toLowerCase()})</dt><dd className="tabular-nums">{q.data.tenant.vehicleCount}</dd></div>
            </dl>
          </header>

          {creds && <CredentialsCard title={creds.title} view={creds.view} onConfirm={() => setCreds(null)} />}

          <section aria-labelledby="admins-title" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="admins-title" className="text-base font-semibold">{t.adminsTitle}</h2>
              <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setAdding(true)} disabled={adding || locked}>{t.addAdmin}</Button>
            </div>
            {adding && <AddAdminForm onSubmit={add} onCancel={() => setAdding(false)} />}
            {q.data.admins.length === 0 ? (
              <EmptyState title={t.noAdmins} />
            ) : (
              <DataTable
                caption={t.adminsTitle}
                columns={columns}
                rows={q.data.admins}
                rowKey={(a) => a.uid}
                actions={(a) => (
                  <div className="inline-flex flex-wrap justify-end gap-1">
                    <Button variant="ghost" size="sm" disabled={locked} aria-label={`${t.edit}: ${a.name}`} onClick={() => setEditing(a)}>{t.edit}</Button>
                    <Button variant="ghost" size="sm" disabled={locked} aria-label={`${t.reset}: ${a.name}`} onClick={() => setResetting(a)}>{t.reset}</Button>
                    <Button variant="ghost" size="sm" disabled={locked} aria-label={`${a.status === 'active' ? t.disable : t.enable}: ${a.name}`} onClick={() => { setDialogError(null); setToggling(a) }}>
                      {a.status === 'active' ? t.disable : t.enable}
                    </Button>
                  </div>
                )}
              />
            )}
          </section>
        </>
      )}

      <EditNameModal admin={editing} onSave={rename} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={resetting !== null}
        title={t.resetTitle}
        body={resetting ? t.resetBody(resetting.name) : ''}
        confirmLabel={t.reset}
        loading={busy}
        onConfirm={() => void reset()}
        onCancel={() => setResetting(null)}
      />
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.status === 'active' ? t.disableTitle : t.enableTitle}
        body={toggling ? (dialogError ?? (toggling.status === 'active' ? t.disableBody(toggling.name) : t.enableBody(toggling.name))) : ''}
        confirmLabel={toggling?.status === 'active' ? t.disable : t.enable}
        tone={toggling?.status === 'active' ? 'danger' : 'primary'}
        loading={busy}
        onConfirm={() => void toggle()}
        onCancel={() => { setToggling(null); setDialogError(null) }}
      />
      {dialog}
    </div>
  )
}
