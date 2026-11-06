import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { EvidenceViewer } from './EvidenceViewer'

vi.mock('@/lib/firebase', () => ({ app: {} }))
vi.mock('firebase/storage', () => ({ getStorage: () => ({}), ref: (_s: unknown, path: string) => path, getDownloadURL: async (path: string) => `https://photos.test/${path}` }))

const items = [
  { key: 'gps', label: 'GPS device', path: 'a/gps.jpg' },
  { key: 'dashcam', label: 'Dashcam', path: 'a/dashcam.jpg' },
  { key: 'extra1', label: 'Extra photo 1', path: 'a/extra1.jpg' },
]

function setup(start = 0) {
  const onIndexChange = vi.fn()
  const onClose = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <EvidenceViewer items={items} index={start} plateNo="WP LJ-4821" onIndexChange={onIndexChange} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onIndexChange, onClose }
}

describe('EvidenceViewer', () => {
  it('shows the photo from the cached download URL with its label and position', async () => {
    setup()
    const img = await screen.findByRole('img', { name: /gps device/i })
    expect(img).toHaveAttribute('src', 'https://photos.test/a/gps.jpg')
    expect(screen.getByText(/WP LJ-4821 · 1 of 3/)).toBeInTheDocument()
  })
  it('arrow keys move between photos and stop at the ends; Esc closes', async () => {
    const { onIndexChange, onClose } = setup(1)
    const user = userEvent.setup()
    await user.keyboard('{ArrowRight}')
    expect(onIndexChange).toHaveBeenLastCalledWith(2)
    await user.keyboard('{ArrowLeft}')
    expect(onIndexChange).toHaveBeenLastCalledWith(0)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('does not go past the first or last photo', async () => {
    const { onIndexChange } = setup(0)
    await userEvent.setup().keyboard('{ArrowLeft}')
    expect(onIndexChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /previous photo/i })).toBeDisabled()
  })
  it('double-click zooms in and again zooms out', async () => {
    setup()
    const img = await screen.findByRole('img', { name: /gps device/i })
    expect(img.style.transform).toContain('scale(1)')
    fireEvent.doubleClick(img)
    expect(img.style.transform).toContain('scale(2.5)')
    fireEvent.doubleClick(img)
    expect(img.style.transform).toContain('scale(1)')
  })
  it('the stamp button zooms to the bottom-left corner and the close button works', async () => {
    const { onClose } = setup()
    const img = await screen.findByRole('img', { name: /gps device/i })
    await userEvent.setup().click(screen.getByRole('button', { name: /zoom to stamp/i }))
    expect(img.style.transform).toContain('scale(3)')
    await userEvent.setup().click(screen.getByRole('button', { name: /close photos/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
