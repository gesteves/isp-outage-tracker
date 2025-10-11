import { render, screen } from '@testing-library/react'
import OutageList from '@/components/OutageList'
import { Outage } from '@/types'

describe('OutageList', () => {
  it('should show message when no outages', () => {
    render(<OutageList outages={[]} />)
    
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
    
    render(<OutageList outages={outages} />)
    
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
    
    render(<OutageList outages={outages} />)
    
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
    
    const { container } = render(<OutageList outages={outages} />)
    
    const outageElements = container.querySelectorAll('.bg-white')
    expect(outageElements).toHaveLength(2)
    // Most recent (test-2) should be first
  })
})

