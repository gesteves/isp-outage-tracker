import { render, screen } from '@testing-library/react'
import StatsDisplay from '@/components/StatsDisplay'
import { OutageStats } from '@/types'

describe('StatsDisplay', () => {
  it('should not render if no tracking start time', () => {
    const stats: OutageStats = {
      totalOutages: 0,
      totalDowntime: 0,
      uptimePercentage: 100,
      trackingStartTime: null,
    }
    
    const { container } = render(<StatsDisplay stats={stats} />)
    
    expect(container.firstChild).toBeNull()
  })

  it('should display uptime percentage', () => {
    const stats: OutageStats = {
      totalOutages: 2,
      totalDowntime: 7200,
      uptimePercentage: 95.83,
      trackingStartTime: '2024-01-01T00:00:00Z',
    }
    
    render(<StatsDisplay stats={stats} />)
    
    expect(screen.getByText('Uptime')).toBeInTheDocument()
    expect(screen.getByText('95.83%')).toBeInTheDocument()
  })

  it('should display total outages count', () => {
    const stats: OutageStats = {
      totalOutages: 3,
      totalDowntime: 10800,
      uptimePercentage: 90,
      trackingStartTime: '2024-01-01T00:00:00Z',
    }
    
    render(<StatsDisplay stats={stats} />)
    
    expect(screen.getByText('Total Outages')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('incidents')).toBeInTheDocument()
  })

  it('should display singular "incident" for one outage', () => {
    const stats: OutageStats = {
      totalOutages: 1,
      totalDowntime: 3600,
      uptimePercentage: 95,
      trackingStartTime: '2024-01-01T00:00:00Z',
    }
    
    render(<StatsDisplay stats={stats} />)
    
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('incident')).toBeInTheDocument()
  })

  it('should display total downtime', () => {
    const stats: OutageStats = {
      totalOutages: 1,
      totalDowntime: 3665, // 1h 1m 5s
      uptimePercentage: 99,
      trackingStartTime: '2024-01-01T00:00:00Z',
    }
    
    render(<StatsDisplay stats={stats} />)
    
    expect(screen.getByText('Total Downtime')).toBeInTheDocument()
    expect(screen.getByText(/1h 1m/)).toBeInTheDocument()
  })

  it('should display tracking start date', () => {
    const stats: OutageStats = {
      totalOutages: 0,
      totalDowntime: 0,
      uptimePercentage: 100,
      trackingStartTime: '2024-01-15T00:00:00Z',
    }
    
    render(<StatsDisplay stats={stats} />)
    
    expect(screen.getByText(/Since/)).toBeInTheDocument()
  })
})

