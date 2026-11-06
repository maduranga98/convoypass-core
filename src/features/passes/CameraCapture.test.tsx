import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraCapture } from './CameraCapture'

const props = { label: 'GPS device photo', plateNo: 'WP LJ-4821', onCapture: vi.fn(), onClose: vi.fn() }

afterEach(() => vi.unstubAllGlobals())

describe('CameraCapture', () => {
  it('shows the file-input fallback when getUserMedia is undefined', () => {
    // jsdom has no navigator.mediaDevices at all.
    expect(navigator.mediaDevices).toBeUndefined()
    const { container } = render(<CameraCapture {...props} />)

    expect(screen.getByRole('status').textContent).toMatch(/can't open the camera/i)
    const input = container.querySelector('input[type="file"]')
    expect(input).not.toBeNull()
    expect(input?.getAttribute('accept')).toBe('image/*')
    expect(input?.getAttribute('capture')).toBe('environment')
    expect(screen.getByRole('button', { name: /take or choose photo/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^capture$/i })).toBeNull()
  })

  it('also falls back, with a permission message, when the camera is denied', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } })
    const { container } = render(<CameraCapture {...props} />)

    expect(await screen.findByText(/blocked/i)).toBeTruthy()
    expect(container.querySelector('input[type="file"][capture="environment"]')).not.toBeNull()
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: 'environment' } }, audio: false })
  })

  it('locks body scroll while open and restores it, and stops the stream on unmount', async () => {
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }], getVideoTracks: () => [{ addEventListener: vi.fn() }] }
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)

    const { unmount } = render(<CameraCapture {...props} />)
    expect(document.body.style.overflow).toBe('hidden')
    await screen.findByRole('button', { name: /^capture$/i })
    unmount()
    expect(stopTrack).toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('')
  })
})
