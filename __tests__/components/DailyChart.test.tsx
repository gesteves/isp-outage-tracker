import { fireEvent, render, screen, within } from '@testing-library/react'
import DailyChart, { axisScale } from '@/components/DailyChart'
import { DayStats } from '@/types'

function day(n: number, overrides: Partial<DayStats> = {}): DayStats {
  const start = new Date(2024, 0, n).getTime()
  return {
    day: `2024-01-${String(n).padStart(2, '0')}`,
    start,
    ispSeconds: 0,
    localSeconds: 0,
    outages: 0,
    monitoredSeconds: 86400,
    ...overrides,
  }
}

const days = [
  day(1, { monitoredSeconds: 0 }), // not monitored
  day(2), // monitored, no downtime
  day(3, { ispSeconds: 1800, localSeconds: 600, outages: 2 }),
  day(4, { ispSeconds: 300, outages: 1 }),
]

const readout = () => screen.getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/, { selector: 'span.font-medium' }).parentElement!

describe('axisScale', () => {
  it('picks clean steps with headroom above the peak', () => {
    expect(axisScale(1800)).toEqual({ max: 2400, ticks: [0, 600, 1200, 1800, 2400] })
    expect(axisScale(3 * 3600)).toEqual({ max: 4 * 3600, ticks: [0, 3600, 7200, 10800, 14400] })
  })

  it('handles no downtime at all', () => {
    expect(axisScale(0)).toEqual({ max: 60, ticks: [0] })
  })
})

describe('DailyChart', () => {
  it('has one selectable button per day, described for screen readers', () => {
    render(<DailyChart days={days} />)
    const buttons = within(screen.getByRole('radiogroup', { name: 'Downtime per day' })).getAllByRole('radio')
    expect(buttons).toHaveLength(4)
    expect(buttons[0]).toHaveAccessibleName(/not monitored/)
    expect(buttons[2]).toHaveAccessibleName(/30m ISP downtime, 10m local network, 2 outages/)
  })

  it('selects today by default and shows it in the readout', () => {
    render(<DailyChart days={days} />)
    expect(screen.getAllByRole('radio')[3]).toHaveAttribute('aria-checked', 'true')
    expect(within(readout()).getByText('5m')).toBeInTheDocument()
  })

  it('pins a tapped day in the readout', () => {
    render(<DailyChart days={days} />)
    fireEvent.click(screen.getAllByRole('radio')[2])
    expect(within(readout()).getByText('30m')).toBeInTheDocument()
    expect(within(readout()).getByText('10m')).toBeInTheDocument()
    expect(within(readout()).getByText('local network')).toBeInTheDocument()
  })

  it('tells "not monitored" apart from "no downtime"', () => {
    render(<DailyChart days={days} />)
    fireEvent.click(screen.getAllByRole('radio')[0])
    expect(within(readout()).getByText('Not monitored')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('radio')[1])
    expect(within(readout()).queryByText('Not monitored')).not.toBeInTheDocument()
    expect(within(readout()).getByText('0s')).toBeInTheDocument()
  })

  it('moves the selection with arrow keys, Home and End', () => {
    render(<DailyChart days={days} />)
    const group = screen.getByRole('radiogroup')
    const radios = screen.getAllByRole('radio')

    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(radios[2]).toHaveAttribute('aria-checked', 'true')
    expect(radios[2]).toHaveFocus()
    expect(radios[2]).toHaveAttribute('tabindex', '0')
    expect(radios[3]).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(group, { key: 'Home' })
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(group, { key: 'End' })
    expect(radios[3]).toHaveAttribute('aria-checked', 'true')
  })

  it('labels only the peak day', () => {
    render(<DailyChart days={days} />)
    const radios = screen.getAllByRole('radio')
    expect(within(radios[2]).getByText('40m')).toBeInTheDocument()
    expect(within(radios[3]).queryByText(/\dm/)).not.toBeInTheDocument()
  })

  it('has a legend and a table view', () => {
    render(<DailyChart days={days} />)
    const legend = screen.getByRole('list', { name: 'Legend' })
    expect(within(legend).getByText('ISP downtime')).toBeInTheDocument()
    expect(within(legend).getByText('Local network')).toBeInTheDocument()
    expect(within(legend).getByText('Not monitored')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(5)
  })

  it('says so when there was no downtime', () => {
    render(<DailyChart days={[day(1), day(2)]} />)
    expect(screen.getByText('No downtime in the last 2 days')).toBeInTheDocument()
  })
})
