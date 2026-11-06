import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ChartPanel } from './ChartPanel'

const panel = (startAsTable = false) => (
  <ChartPanel
    title="Trend"
    label="Chart: 3 submitted on Monday"
    chart={<svg data-testid="the-chart" />}
    table={<table><tbody><tr><td>Monday</td><td>3</td></tr></tbody></table>}
    startAsTable={startAsTable}
  />
)

describe('ChartPanel', () => {
  it('describes the chart in text and offers the same numbers as a table', async () => {
    render(panel())
    expect(screen.getByRole('img', { name: 'Chart: 3 submitted on Monday' })).toBeInTheDocument()
    expect(await screen.findByTestId('the-chart')).toBeInTheDocument()
    expect(screen.queryByTestId('chart-table')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'View as table' }))
    expect(screen.getByTestId('chart-table')).toHaveTextContent('Monday3')
    expect(screen.queryByTestId('the-chart')).toBeNull()
    expect(screen.getByRole('button', { name: 'View as chart' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'View as chart' }))
    expect(await screen.findByTestId('the-chart')).toBeInTheDocument()
  })
  it('can start as a table', () => {
    render(panel(true))
    expect(screen.getByTestId('chart-table')).toBeInTheDocument()
  })
})
