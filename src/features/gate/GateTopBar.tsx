import { CloudUpload, LogOut, MapPin, Settings, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { SimpleMenu } from '@/features/shared/SimpleMenu'
import { BrandMark } from '@/components/BrandMark'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { Bell } from '@/features/notifications/Bell'
import { useOnline } from '@/features/passes/useOnline'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useSoundOn } from './deviceSettings'
import { GatePicker } from './GatePicker'
import { useOfflineQueue } from './gateQueue'
import { useGates } from './useGate'

const t = strings.gate
const iconBtn =
  'inline-flex size-14 shrink-0 items-center justify-center rounded-lg text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/**
 * One row that fits a 360 px phone (Module 12: kept minimal for guards). The gate chip shows only when the tenant has more
 * than one gate, the offline queue only when it holds items; sound and sign-out live in the menu.
 */
export function GateTopBar() {
  const { uid } = useSession()
  const { signOut } = useAuth()
  const online = useOnline()
  const { gates, gate, setGate } = useGates()
  const [soundOn, setSoundOn] = useSoundOn()
  const queued = useOfflineQueue(uid)
  const waiting = queued.filter((i) => i.status === 'waiting').length
  const [picking, setPicking] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  const navigate = useNavigate()
  const manyGates = gates.length > 1

  const leave = () => (queued.length > 0 ? setConfirmOut(true) : void signOut())

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-surface">
      <div className="mx-auto flex h-16 max-w-3xl items-center gap-1.5 px-3">
        {manyGates ? (
          <button
            type="button"
            onClick={() => setPicking(true)}
            aria-label={gate ? `${t.gateLabel(gate.name)}. ${t.changeGate}` : t.chooseGate}
            className={cn(
              'inline-flex h-12 min-w-24 flex-1 items-center gap-1.5 rounded-full border-2 px-3 text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              gate ? 'border-slate-300 bg-surface text-ink' : 'border-accent bg-accent-soft text-warning-ink',
            )}
          >
            <MapPin aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{gate?.name ?? t.chooseGate}</span>
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <BrandMark className="size-9 rounded-lg" />
            <span className="truncate text-base font-bold text-ink">{gate?.name ?? t.topBar}</span>
          </span>
        )}

        <span
          role="status"
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-bold',
            online ? 'bg-success-soft text-success-strong' : 'bg-brand text-on-solid',
          )}
        >
          {online ? <Wifi aria-hidden className="size-4" /> : <WifiOff aria-hidden className="size-4" />}
          {/* Icon only on a narrow phone so the gate name keeps its room; the status stays announced. */}
          <span className="sr-only min-[440px]:not-sr-only">{online ? t.online : t.offline}</span>
        </span>

        {queued.length > 0 && (
          <Link to="/security/queue" aria-label={`${t.openQueue}: ${t.queueBadge(waiting)}`} className={cn(iconBtn, 'relative')}>
            <CloudUpload aria-hidden className="size-6" />
            {waiting > 0 && (
              <span aria-hidden className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-accent px-1 text-center text-xs font-black text-ink">
                {waiting}
              </span>
            )}
          </Link>
        )}

        <Bell />

        <SimpleMenu
          label={t.menu}
          items={[
            {
              label: soundOn ? t.soundOn : t.soundOff,
              icon: soundOn ? <Volume2 aria-hidden className="size-6" /> : <VolumeX aria-hidden className="size-6" />,
              pressed: soundOn,
              onSelect: () => setSoundOn(!soundOn),
            },
            { label: strings.userSettings.title, icon: <Settings aria-hidden className="size-6" />, onSelect: () => void navigate('/settings') },
            { label: strings.common.signOut, icon: <LogOut aria-hidden className="size-6" />, onSelect: leave },
          ]}
        />
      </div>

      <GatePicker
        open={picking}
        gates={gates}
        current={gate?.id ?? null}
        onPick={(id) => {
          setGate(id)
          setPicking(false)
        }}
        onClose={() => setPicking(false)}
      />
      <ConfirmDialog
        open={confirmOut}
        title={t.signOutTitle}
        body={t.signOutPending(queued.length)}
        confirmLabel={strings.common.signOut}
        tone="danger"
        onConfirm={() => void signOut()}
        onCancel={() => setConfirmOut(false)}
      />
    </header>
  )
}
