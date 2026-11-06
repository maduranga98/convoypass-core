import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useState, type ComponentProps } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { strings } from '@/lib/strings'

type Props = Omit<ComponentProps<typeof Input>, 'type' | 'trailing'>

/** Password field with a show/hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(rest, ref) {
  const [show, setShow] = useState(false)
  return (
    <Input
      ref={ref}
      type={show ? 'text' : 'password'}
      autoCapitalize="none"
      spellCheck={false}
      trailing={
        <Button variant="ghost" size="icon" onClick={() => setShow((s) => !s)} aria-label={show ? strings.auth.hidePassword : strings.auth.showPassword} aria-pressed={show}>
          {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </Button>
      }
      {...rest}
    />
  )
})
