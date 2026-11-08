import { render, screen } from '@testing-library/react'
import OutageList from '@/components/OutageList'
import { Outage } from '@/types'

const NOW = Date.parse('2024-01-03T00:00:00Z')

describe('OutageList', () => {
  it('should show message when no outages', () => {
    render(<OutageList outages={[]} now={NOW} />)
    
    expect(screen.getByText('No outages recorded yet.')).toBeInTheDocument()
    expect(screen.getByText('Keep this tab open to track outages.')).toBeInTheDocument()
  })

  it('should display completed outages', () => {
    const outages: Outage[] = [
      {
        id: 'test-1',
        startTime: new Date('2024-01-01T10:00:00Z').toISOString(),
        endTime: new Date('2024-01-01T11:00:00Z').toISOString(),
        duration: 3600,
      },
    ]
    
    render(<OutageList outages={outages} now={NOW} />)
    
    expect(screen.getByText('Started')).toBeInTheDocument()
    expect(screen.getByText('Ended')).toBeInTheDocument()
    expect(screen.getByText('Duration')).toBeInTheDocument()
  })

  it('should display ongoing outages', () => {
    const outages: Outage[] = [
      {
        id: 'test-1',
        startTime: new Date('2024-01-01T10:00:00Z').toISOString(),
        endTime: null,
        duration: null,
      },
    ]
    
    render(<OutageList outages={outages} now={NOW} />)
    
    expect(screen.getByText('Ongoing')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
  })

  it('should sort outages by most recent first', () => {
    const outages: Outage[] = [
      {
        id: 'test-1',
        startTime: new Date('2024-01-01T10:00:00Z').toISOString(),
        endTime: new Date('2024-01-01T11:00:00Z').toISOString(),
        duration: 3600,
      },
      {
        id: 'test-2',
        startTime: new Date('2024-01-02T10:00:00Z').toISOString(),
        endTime: new Date('2024-01-02T11:00:00Z').toISOString(),
        duration: 3600,
      },
    ]
    
    render(<OutageList outages={outages} now={NOW} />)

    const startTimes = screen
      .getAllByText('Started')
      .map(label => label.nextElementSibling?.textContent)
    expect(startTimes).toEqual([
      new Date('2024-01-02T10:00:00Z').toLocaleString(),
      new Date('2024-01-01T10:00:00Z').toLocaleString(),
    ])
  })

  it('shows relative times from the given now', () => {
    const outages: Outage[] = [
      { id: 'a', startTime: '2024-01-02T23:00:00Z', endTime: '2024-01-02T23:30:00Z', duration: 1800 },
    ]
    render(<OutageList outages={outages} now={NOW} />)
    expect(screen.getByText('1 hour ago')).toBeInTheDocument()
    expect(screen.getByText('30 minutes ago')).toBeInTheDocument()
  })

  it('shows the ISP and marks local network outages', () => {
    const outages: Outage[] = [
      { id: 'a', startTime: '2024-01-01T10:00:00Z', endTime: null, duration: null, cause: 'local', isp: 'Comcast' },
      { id: 'b', startTime: '2024-01-01T09:00:00Z', endTime: '2024-01-01T09:01:00Z', duration: 60, cause: 'isp' },
    ]
    render(<OutageList outages={outages} now={NOW} />)
    expect(screen.getAllByText('Local network')).toHaveLength(1)
    expect(screen.getByText('Comcast')).toBeInTheDocument()
  })
})

