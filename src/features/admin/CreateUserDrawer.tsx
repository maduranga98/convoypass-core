import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Dices } from 'lucide-react'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { createUser } from '@/lib/api'
import { generatePassword, isValidPassword, normalisePhone } from '@/lib/credentials'
import { apiErrorMessage } from '@/lib/errors'
import { CREATABLE_ROLES, ROLES, type Role } from '@/lib/roles'
import { isPinRole } from '@/lib/session'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'
import { useContractors } from './queries'
import { CredentialsReveal } from './CredentialsReveal'
import { PinCard } from './PinCard'
import { useIssuedPin, type IssuedPin } from './pinCardState'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.admin.createUser
const needsContractor = (r: Role) => r === 'supervisor' || r === 'driver'

const schema = z
  .object({
    role: z.enum(ROLES),
    name: z.string().trim().min(1, t.nameRequired).max(100),
    email: z.string().trim(),
    phone: z.string().trim(),
    contractorId: z.string(),
    password: z.string(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    if (isPinRole(v.role)) {
      // Drivers and security (Module 12): a name, an optional contact number; the server makes the PIN.
      if (v.phone !== '' && !normalisePhone(v.phone)) issue('phone', strings.auth.invalidPhone)
    } else {
      if (!z.string().email().safeParse(v.email).success) issue('email', strings.auth.invalidEmail)
      if (!isValidPassword(v.password)) issue('password', strings.auth.passwordTooShort)
    }
    if (needsContractor(v.role) && !v.contractorId) issue('contractorId', t.contractorRequired)
  })
type Values = z.infer<typeof schema>

interface StaffCredentials {
  loginId: string
  secret: string
}

/**
 * Create a user. Office staff get an email and a temporary password (shown once). Drivers and security get NO password:
 * the server returns their PIN once and the PIN card shows it until "I've given it to them".
 */
export function CreateUserDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [staff, setStaff] = useState<StaffCredentials | null>(null)
  const [issued, setIssued] = useIssuedPin()

  const close = () => {
    setStaff(null)
    setIssued(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={issued === null}
      title={issued ? strings.pinCard.title : staff ? t.credentialsTitle : t.title}
      variant="drawer"
    >
      {issued ? (
        <PinCard issued={issued} onDone={close} />
      ) : staff ? (
        <CredentialsReveal {...staff} onDone={close} />
      ) : (
        <CreateUserForm onStaff={setStaff} onPin={setIssued} />
      )}
    </Modal>
  )
}

function CreateUserForm({ onStaff, onPin }: { onStaff: (c: StaffCredentials) => void; onPin: (p: IssuedPin) => void }) {
  const queryClient = useQueryClient()
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const contractors = useContractors()
  const activeContractors = (contractors.data ?? []).filter((c) => c.status === 'active')
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'supervisor', name: '', email: '', phone: '', contractorId: '', password: '' },
  })

  const role = useWatch({ control, name: 'role' })
  const pinRole = isPinRole(role)

  const submit = async (v: Values) => {
    setFormError(null)
    try {
      const res = await createUser({
        role: v.role,
        name: v.name,
        ...(isPinRole(v.role) ? (v.phone ? { phone: v.phone } : {}) : { email: v.email, password: v.password }),
        ...(needsContractor(v.role) ? { contractorId: v.contractorId } : {}),
      })
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(t.created)
      if (res.pin) {
        const company = v.role === 'driver' ? (activeContractors.find((c) => c.id === v.contractorId)?.name ?? '') : (tenant.data?.name ?? '')
        onPin({ pin: res.pin, name: v.name.trim(), role: v.role, company })
      } else {
        onStaff({ loginId: v.email, secret: v.password })
      }
    } catch (e) {
      setFormError(apiErrorMessage(e))
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      {formError && (
        <NotificationBanner tone="error">{formError}</NotificationBanner>
      )}

      <Select label={t.role} {...register('role')}>
        {CREATABLE_ROLES.map((r) => (
          <option key={r} value={r}>
            {strings.roles[r]}
          </option>
        ))}
      </Select>

      <Input label={t.name} autoComplete="off" error={errors.name?.message} {...register('name')} />

      {needsContractor(role) && (
        <Select
          label={t.contractor}
          error={errors.contractorId?.message}
          hint={!contractors.isPending && activeContractors.length === 0 ? t.noContractors : undefined}
          disabled={contractors.isPending}
          {...register('contractorId')}
        >
          <option value="">{t.contractorPlaceholder}</option>
          {activeContractors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}

      {pinRole ? (
        <>
          <Input
            label={t.phone}
            optional
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder={strings.auth.phoneHint}
            hint={t.phoneHint}
            error={errors.phone?.message}
            {...register('phone')}
          />
          <NotificationBanner tone="info">{t.pinNote}</NotificationBanner>
        </>
      ) : (
        <>
          <Input
            label={t.email}
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            error={errors.email?.message}
            {...register('email')}
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={t.password}
                type="text"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                error={errors.password?.message}
                {...register('password')}
              />
            </div>
            <Button
              variant="secondary"
              className="mb-px"
              icon={<Dices aria-hidden className="size-4" />}
              onClick={() => setValue('password', generatePassword(), { shouldValidate: true })}
            >
              {t.generate}
            </Button>
          </div>
        </>
      )}

      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t.submit}
      </Button>
    </form>
  )
}
