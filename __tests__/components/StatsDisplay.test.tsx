import { render, screen } from '@testing-library/react'
import StatsDisplay from '@/components/StatsDisplay'
import { OutageStats } from '@/types'

function stats(overrides: Partial<OutageStats> = {}): OutageStats {
  return {
    trackingStartTime: '2024-01-01T00:00:00Z',
    trackedSeconds: 5 * 86400,
    monitoredSeconds: 3 * 86400 + 4 * 3600,
    ispOutages: 2,
    ispDowntime: 3665,
    localOutages: 0,
    localDowntime: 0,
    uptimePercentage: 95.83,
    ...overrides,
  }
}

describe('StatsDisplay', () => {
  it('should not render if no tracking start time', () => {
    const { container } = render(<StatsDisplay stats={stats({ trackingStartTime: null })} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows uptime with how much time was actually monitored', () => {
    render(<StatsDisplay stats={stats()} />)
    expect(screen.getByText('95.83%')).toBeInTheDocument()
    expect(screen.getByText(/Monitored 3d 4h of 5d since/)).toBeInTheDocument()
  })

  it('drops small units from long monitored times', () => {
    render(<StatsDisplay stats={stats({ monitoredSeconds: 20 * 86400 + 22 * 3600 + 6 })} />)
    expect(screen.getByText(/Monitored 20d 22h of 5d since/)).toBeInTheDocument()
  })

  it('shows ISP outages and downtime', () => {
    render(<StatsDisplay stats={stats()} />)
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('incidents')).toBeInTheDocument()
    expect(screen.getByText('1h 1m 5s')).toBeInTheDocument()
  })

  it('uses the singular for one incident', () => {
    render(<StatsDisplay stats={stats({ ispOutages: 1 })} />)
    expect(screen.getByText('incident')).toBeInTheDocument()
  })

  it('notes local network outages separately', () => {
    const { rerender } = render(<StatsDisplay stats={stats()} />)
    expect(screen.queryByText(/local network/)).not.toBeInTheDocument()

    rerender(<StatsDisplay stats={stats({ localOutages: 1, localDowntime: 120 })} />)
    expect(screen.getByText('+ 1 local network outage (2m), not counted')).toBeInTheDocument()
  })
})
