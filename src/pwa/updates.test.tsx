import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CameraCapture } from '@/features/passes/CameraCapture'
import { acquireUpdateLock, isUpdateLocked } from './updateLock'
import { createUpdateController } from './updates'

const make = () => {
  const env = { isLocked: isUpdateLocked, applyUpdate: vi.fn(), promptReload: vi.fn() }
  return { env, controller: createUpdateController(env) }
}

describe('update controller', () => {
  it('applies a new version straight away (autoUpdate) when nothing is open', () => {
    const { env, controller } = make()
    controller.onUpdateReady()
    expect(env.applyUpdate).toHaveBeenCalledTimes(1)
    expect(env.promptReload).not.toHaveBeenCalled()
  })

  it('asks instead of reloading while a lock is held, once, and reloads only when the person agrees', () => {
    const { env, controller } = make()
    const release = acquireUpdateLock()
    controller.onUpdateReady()
    controller.onUpdateReady()
    expect(env.applyUpdate).not.toHaveBeenCalled()
    expect(env.promptReload).toHaveBeenCalledTimes(1)
    const apply = env.promptReload.mock.calls[0]?.[0] as () => void
    release()
    apply()
    expect(env.applyUpdate).toHaveBeenCalledTimes(1)
  })

  it('does not reload during a camera capture: the open camera holds the lock', () => {
    const { env, controller } = make()
    const { unmount } = render(<CameraCapture label="GPS" plateNo="WP LJ-4821" onCapture={vi.fn()} onClose={vi.fn()} />)
    expect(isUpdateLocked()).toBe(true)
    controller.onUpdateReady()
    expect(env.applyUpdate).not.toHaveBeenCalled()
    expect(env.promptReload).toHaveBeenCalledTimes(1)
    unmount()
    expect(isUpdateLocked()).toBe(false)
  })
})
