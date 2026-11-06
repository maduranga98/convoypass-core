import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormContext } from '@/types/passes'

vi.mock('@/lib/firebase', () => ({ storage: {}, db: {}, functions: {}, auth: {} }))
vi.mock('@/lib/api', () => ({ submitPass: vi.fn() }))
vi.mock('@/features/auth/useAuth', () => ({
  useSession: () => ({ uid: 'drv1', claims: { role: 'driver', tenantId: 'T1', contractorId: 'C1' }, profile: { name: 'Sunil' } }),
}))
// The camera is covered by its own tests: here "capturing" is one click.
vi.mock('./CameraCapture', () => ({
  CameraCapture: ({ onCapture, label }: { onCapture: (r: unknown) => void; label: string }) => (
    <button onClick={() => onCapture({ blob: new Blob(['x'], { type: 'image/jpeg' }), method: 'file', capturedAt: '2026-03-10T10:00:00Z' })}>
      {`shutter ${label}`}
    </button>
  ),
}))
const uploads: { resolve: () => void; path: string }[] = []
vi.mock('./upload', () => ({
  uploadEvidence: (path: string) => new Promise<void>((resolve) => uploads.push({ resolve, path })),
}))

import { PreTripForm } from './PreTripForm'

const ctx: FormContext = {
  vehicle: { id: 'veh_aaaaaaaaaa', plateNo: 'WP LJ-4821', type: 'Tipper' },
  attempt: 1,
  dateKey: '20260310',
  passSettings: { requireLocation: false, maxExtraPhotos: 2 },
  checklist: [
    { id: 'a', label: 'Dashcam is recording', failBlocks: false },
    { id: 'b', label: 'Brakes work', failBlocks: true },
  ],
}

const renderForm = (over: Partial<FormContext> = {}) =>
  render(<PreTripForm ctx={{ ...ctx, ...over }} onSubmitted={vi.fn()} onReload={vi.fn()} />)

const submitButton = () => screen.getByRole('button', { name: /^send$/i })
const radio = (group: string, name: 'Yes' | 'No') => within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name })

async function takePhoto(user: ReturnType<typeof userEvent.setup>, tileName: RegExp, label: string) {
  await user.click(screen.getAllByRole('button', { name: tileName })[0] as HTMLElement)
  await user.click(screen.getByRole('button', { name: `shutter ${label}` }))
}
const finishUploads = async () => {
  uploads.splice(0).forEach((u) => u.resolve())
  await waitFor(() => expect(screen.queryByText(/uploading/i)).toBeNull())
}

beforeEach(() => {
  uploads.length = 0
  sessionStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

describe('PreTripForm', () => {
  it('nothing is preselected and Submit starts disabled', () => {
    renderForm()
    expect(submitButton().hasAttribute('disabled')).toBe(true)
    for (const g of ['Dashcam is recording', 'Brakes work']) {
      expect(radio(g, 'Yes').getAttribute('aria-checked')).toBe('false')
      expect(radio(g, 'No').getAttribute('aria-checked')).toBe('false')
    }
    expect(screen.getByText('0 of 4 done')).toBeTruthy()
  })

  it('"All OK" sets every item to Yes', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: 'All OK' }))
    for (const g of ['Dashcam is recording', 'Brakes work']) {
      expect(radio(g, 'Yes').getAttribute('aria-checked')).toBe('true')
      expect(radio(g, 'No').getAttribute('aria-checked')).toBe('false')
    }
    expect(submitButton().hasAttribute('disabled')).toBe(true) // photos still missing
  })

  it('stays disabled until both photos have finished uploading AND every item is answered', async () => {
    const user = userEvent.setup()
    renderForm()
    await takePhoto(user, /GPS device photo/i, 'GPS device photo')
    await takePhoto(user, /Dashcam photo/i, 'Dashcam photo')
    await user.click(screen.getByRole('button', { name: 'All OK' }))

    // Both photos are captured but still uploading.
    expect(uploads.map((u) => u.path)).toEqual([
      'tenants/T1/passes/veh_aaaaaaaaaa/20260310/1/gps.jpg',
      'tenants/T1/passes/veh_aaaaaaaaaa/20260310/1/dashcam.jpg',
    ])
    expect(submitButton().hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/waiting for photos to finish/i)).toBeTruthy()

    await finishUploads()
    await waitFor(() => expect(submitButton().hasAttribute('disabled')).toBe(false))
    expect(screen.getByText('4 of 4 done')).toBeTruthy()
  })

  it('photos done but a checklist item unanswered keeps Submit disabled', async () => {
    const user = userEvent.setup()
    renderForm()
    await takePhoto(user, /GPS device photo/i, 'GPS device photo')
    await takePhoto(user, /Dashcam photo/i, 'Dashcam photo')
    await finishUploads()
    await user.click(radio('Dashcam is recording', 'Yes'))
    expect(submitButton().hasAttribute('disabled')).toBe(true)
    await user.click(radio('Brakes work', 'Yes'))
    expect(submitButton().hasAttribute('disabled')).toBe(false)
  })

  it('a normal "No" needs a note and warns the supervisor will see it', async () => {
    const user = userEvent.setup()
    renderForm()
    await takePhoto(user, /GPS device photo/i, 'GPS device photo')
    await takePhoto(user, /Dashcam photo/i, 'Dashcam photo')
    await finishUploads()
    await user.click(radio('Brakes work', 'Yes'))
    await user.click(radio('Dashcam is recording', 'No'))
    expect(screen.getByText('Your supervisor will see this.')).toBeTruthy()
    expect(submitButton().hasAttribute('disabled')).toBe(true)
    await user.type(screen.getByLabelText('What is wrong?'), 'Card slot broken')
    expect(submitButton().hasAttribute('disabled')).toBe(false)
  })

  it('a blocking item answered No shows the message and disables Submit even with a note', async () => {
    const user = userEvent.setup()
    renderForm()
    await takePhoto(user, /GPS device photo/i, 'GPS device photo')
    await takePhoto(user, /Dashcam photo/i, 'Dashcam photo')
    await finishUploads()
    await user.click(radio('Dashcam is recording', 'Yes'))
    await user.click(radio('Brakes work', 'No'))
    await user.type(screen.getByLabelText('What is wrong?'), 'Spongy pedal')
    expect(screen.getByText(/Fix this before the trip/i)).toBeTruthy()
    expect(submitButton().hasAttribute('disabled')).toBe(true)
  })

  it('restores checklist answers after a reload (sessionStorage), but never photos', async () => {
    const user = userEvent.setup()
    const first = renderForm()
    await user.click(screen.getByRole('button', { name: 'All OK' }))
    first.unmount()
    renderForm()
    expect(radio('Brakes work', 'Yes').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText(/uploaded/i)).toBeNull()
  })

  it('only offers as many extra photos as the tenant allows', () => {
    const { unmount } = renderForm({ passSettings: { requireLocation: false, maxExtraPhotos: 0 } })
    expect(screen.queryByText('Extra photos')).toBeNull()
    unmount()
    renderForm({ passSettings: { requireLocation: false, maxExtraPhotos: 1 } })
    expect(screen.getAllByRole('button', { name: /add photo/i })).toHaveLength(1)
  })
})
