import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { no } from '@/test/passFactory'
import { ChecklistSummary } from './ChecklistSummary'

describe('ChecklistSummary', () => {
  it('lists every item; No rows are highlighted and carry the driver’s note', () => {
    render(<ChecklistSummary items={[{ id: 'a', label: 'Dashcam is recording', answer: 'yes' }, no('b')]} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.getAttribute('data-answer')).toBe('yes')
    expect(rows[1]?.getAttribute('data-answer')).toBe('no')
    expect(rows[1]?.className).toContain('bg-danger-soft')
    expect(within(rows[1] as HTMLElement).getByText(/Loose cable/)).toBeTruthy()
    expect(screen.queryByText('All answers are Yes')).toBeNull()
  })
  it('says so when everything is Yes', () => {
    render(<ChecklistSummary items={[{ id: 'a', label: 'Item a', answer: 'yes' }]} />)
    expect(screen.getByText('All answers are Yes')).toBeTruthy()
  })
})
