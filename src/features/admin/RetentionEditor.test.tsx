import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

const getDownloadURL = vi.fn()
vi.mock('firebase/storage', () => ({ getStorage: () => ({}), getDownloadURL: (...a: unknown[]) => getDownloadURL(...a), ref: (_s: unknown, p: string) => p }))
vi.mock('@/lib/firebase', () => ({ app: {} }))

import { EvidenceThumb } from '@/features/passes/EvidenceThumb'
import { RetentionEditor } from './RetentionEditor'
import { retentionOk } from './reasons'

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>

describe('RetentionEditor', () => {
  it('is off by default (keep forever), always shows the permanent-deletion warning and no days field', () => {
    render(<RetentionEditor value={0} onChange={vi.fn()} showErrors={false} />)
    expect(screen.getByRole('radio', { name: /keep photos forever/i })).toBeChecked()
    expect(screen.getByRole('note')).toHaveTextContent(/deletion is permanent/i)
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })
  it('choosing removal starts at a safe-looking 365 days and shows the days field', () => {
    const onChange = vi.fn()
    render(<RetentionEditor value={0} onChange={onChange} showErrors={false} />)
    fireEvent.click(screen.getByRole('radio', { name: /remove photos after/i }))
    expect(onChange).toHaveBeenCalledWith(365)
  })
  it('flags values outside 30-3650 and accepts 0 or in-range whole numbers', () => {
    render(<RetentionEditor value={10} onChange={vi.fn()} showErrors />)
    expect(screen.getByText(/between 30 and 3650/i)).toBeInTheDocument()
    for (const ok of [0, 30, 365, 3650]) expect(retentionOk(ok)).toBe(true)
    for (const bad of [1, 29, 3651, 45.5, Number.NaN, -1]) expect(retentionOk(bad)).toBe(false)
  })
})

describe('evidence removed per retention policy', () => {
  it('shows the message and never asks Storage for a photo that was deleted', () => {
    render(wrap(<EvidenceThumb path="tenants/T1/passes/v/20250101/1/gps.jpg" alt="GPS photo" removed />))
    expect(screen.getByRole('img', { name: 'Evidence removed per retention policy' })).toBeInTheDocument()
    expect(getDownloadURL).not.toHaveBeenCalled()
  })
})
