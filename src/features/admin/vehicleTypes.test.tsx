import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EligibilityBadge } from '@/components/ui/EligibilityBadge'
import { expiryDaysOk, vehicleTypesOk } from './reasons'
import { VehicleTypesEditor } from './VehicleTypesEditor'

describe('vehicleTypesOk', () => {
  it('needs 1-30 names of 2-40 characters, unique ignoring case', () => {
    expect(vehicleTypesOk(['Tipper'])).toBe(true)
    expect(vehicleTypesOk([])).toBe(false)
    expect(vehicleTypesOk(['A'])).toBe(false)
    expect(vehicleTypesOk(['Tipper', ' tipper '])).toBe(false)
    expect(vehicleTypesOk(Array.from({ length: 31 }, (_, i) => `Type ${i}`))).toBe(false)
  })
  it('limits the warning window to 1-90 whole days', () => {
    expect([0, 1, 90, 91, 1.5, Number.NaN].map(expiryDaysOk)).toEqual([false, true, true, false, false, false])
  })
})

describe('VehicleTypesEditor', () => {
  const base = { showErrors: false, usingDefaults: false }

  it('locks and cannot remove a saved type that vehicles use', () => {
    render(<VehicleTypesEditor {...base} items={['Tipper', 'Lorry']} saved={['Tipper', 'Lorry']} inUse={new Set(['Tipper'])} onChange={() => undefined} />)
    expect(screen.getAllByLabelText('Type name')[0]).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Remove: Tipper' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove: Lorry' })).toBeEnabled()
  })

  it('adds a blank row and removes an unused one', async () => {
    const onChange = vi.fn()
    render(<VehicleTypesEditor {...base} items={['Tipper', 'Lorry']} saved={['Tipper', 'Lorry']} inUse={new Set()} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add type' }))
    expect(onChange).toHaveBeenLastCalledWith(['Tipper', 'Lorry', ''])
    await userEvent.click(screen.getByRole('button', { name: 'Remove: Lorry' }))
    expect(onChange).toHaveBeenLastCalledWith(['Tipper'])
  })

  it('flags duplicates when errors are shown', () => {
    render(<VehicleTypesEditor showErrors usingDefaults={false} items={['Tipper', 'tipper']} saved={[]} inUse={new Set()} onChange={() => undefined} />)
    expect(screen.getAllByText(/no duplicates/)).toHaveLength(1)
  })
})

describe('EligibilityBadge', () => {
  it.each([
    [undefined, 'Valid'],
    ['valid', 'Valid'],
    ['expiringSoon', 'Expiring soon'],
    ['expired', 'Expired'],
  ] as const)('%s shows the word, not just a colour', (status, word) => {
    render(<EligibilityBadge status={status} />)
    expect(screen.getByText(word)).toBeInTheDocument()
  })
})
