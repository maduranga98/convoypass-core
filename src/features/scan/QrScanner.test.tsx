import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  onRead: null as null | ((text: string) => void),
  startError: null as unknown,
  stop: vi.fn(),
  clear: vi.fn(),
}))

vi.mock('html5-qrcode', () => ({
  Html5QrcodeSupportedFormats: { QR_CODE: 0 },
  Html5Qrcode: class {
    isScanning = false
    async start(_camera: unknown, _config: unknown, onRead: (text: string) => void) {
      if (h.startError) throw h.startError
      h.onRead = onRead
      this.isScanning = true
      return null
    }
    async stop() {
      this.isScanning = false
      h.stop()
    }
    clear() {
      h.clear()
    }
    getRunningTrackCameraCapabilities() {
      return { torchFeature: () => ({ isSupported: () => false }) }
    }
  },
}))

const { QrScanner } = await import('./QrScanner')
const { appBase } = await import('@/lib/appUrl')
// Whatever VITE_APP_BASE_URL the environment sets; the scanner falls back to this page's origin.
const BASE = appBase?.url ?? window.location.origin

beforeEach(() => {
  h.onRead = null
  h.startError = null
  h.stop.mockReset()
  h.clear.mockReset()
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
  localStorage.setItem('cp_scan_explained', '1')
})

describe('QrScanner', () => {
  it('shows "Not a ConvoyPass QR code" for a foreign code and keeps scanning', async () => {
    const onVehicle = vi.fn()
    render(<QrScanner onVehicle={onVehicle} onClose={vi.fn()} />)
    await waitFor(() => expect(h.onRead).not.toBeNull())
    act(() => h.onRead?.('https://evil.example.com/v/veh_ab12cd34ef'))
    expect(screen.getByRole('alert')).toHaveTextContent('Not a ConvoyPass sticker')
    act(() => h.onRead?.('WIFI:S:guest;;'))
    expect(onVehicle).not.toHaveBeenCalled()
    expect(h.stop).not.toHaveBeenCalled()
  })
  it('stops the camera, then opens the vehicle for our code (once, however often it is read)', async () => {
    const onVehicle = vi.fn()
    render(<QrScanner onVehicle={onVehicle} onClose={vi.fn()} />)
    await waitFor(() => expect(h.onRead).not.toBeNull())
    act(() => {
      h.onRead?.(`${BASE}/v/veh_ab12cd34ef/`)
      h.onRead?.(`${BASE}/v/veh_ab12cd34ef/`)
    })
    await waitFor(() => expect(onVehicle).toHaveBeenCalledWith('veh_ab12cd34ef'))
    expect(onVehicle).toHaveBeenCalledTimes(1)
    expect(h.stop).toHaveBeenCalled()
  })
  it('stops the camera on unmount', async () => {
    const { unmount } = render(<QrScanner onVehicle={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(h.onRead).not.toBeNull())
    unmount()
    await waitFor(() => expect(h.stop).toHaveBeenCalled())
  })
  it('explains a blocked camera with short plain steps (Android)', async () => {
    h.startError = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    render(<QrScanner onVehicle={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('Camera is blocked')).toBeInTheDocument()
    expect(screen.getByText('Android')).toBeInTheDocument()
    expect(screen.getByText('Tap Permissions, then Camera.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
  it('shows iPhone steps on an iPhone', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    h.startError = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    render(<QrScanner onVehicle={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('iPhone')).toBeInTheDocument()
    expect(screen.getByText('Tap Safari, then Camera.')).toBeInTheDocument()
    ua.mockRestore()
  })
  it('first use: explains the camera prompt before starting the camera, once per phone', async () => {
    localStorage.removeItem('cp_scan_explained')
    const { unmount } = render(<QrScanner onVehicle={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Allow the camera so you can scan')).toBeInTheDocument()
    expect(h.onRead).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'OK, open camera' }))
    await waitFor(() => expect(h.onRead).not.toBeNull())
    unmount()
    render(<QrScanner onVehicle={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText('Allow the camera so you can scan')).toBeNull()
  })
})
