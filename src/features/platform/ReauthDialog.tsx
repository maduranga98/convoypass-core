import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { strings } from '@/lib/strings'
import { WrongPassword } from './reauth'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.platform.reauth

export function ReauthDialog({ open, onConfirm, onCancel, onSignInPage }: { open: boolean; onConfirm: (password: string) => Promise<void>; onCancel: () => void; onSignInPage?: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onConfirm(password)
      setPassword('')
    } catch (err) {
      setError(err instanceof WrongPassword ? t.wrong : t.failed)
    } finally {
      setBusy(false)
    }
  }
  const cancel = () => {
    setPassword('')
    setError(null)
    onCancel()
  }

  return (
    <Modal open={open} onClose={cancel} title={t.title}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <p className="text-sm text-slate-600">{t.body}</p>
        <Input label={t.password} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <NotificationBanner tone="error">{error}</NotificationBanner>}
        {onSignInPage && (
          <button type="button" onClick={onSignInPage} className="inline-flex min-h-11 items-center text-sm text-slate-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus">
            {strings.platformAuth.reauthGoToSignIn}
          </button>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={cancel} disabled={busy}>{strings.common.cancel}</Button>
          <Button type="submit" loading={busy} disabled={password.length === 0}>{t.confirm}</Button>
        </div>
      </form>
    </Modal>
  )
}
