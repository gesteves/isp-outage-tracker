import { fireEvent, render, screen } from '@testing-library/react'
import OutageList, { PAGE_SIZE } from '@/components/OutageList'
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

  describe('pages', () => {
    const many: Outage[] = Array.from({ length: PAGE_SIZE + 3 }, (_, i) => ({
      id: `o${i}`,
      startTime: new Date(Date.parse('2024-01-01T00:00:00Z') + i * 3600_000).toISOString(),
      endTime: new Date(Date.parse('2024-01-01T00:00:00Z') + i * 3600_000 + 60_000).toISOString(),
      duration: 60,
    }))

    it('shows the most recent outages first, then more on request', () => {
      render(<OutageList outages={many} now={NOW} />)
      expect(screen.getAllByText('Started')).toHaveLength(PAGE_SIZE)
      fireEvent.click(screen.getByRole('button', { name: 'Show 3 more (3 older)' }))
      expect(screen.getAllByText('Started')).toHaveLength(PAGE_SIZE + 3)
      expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument()
    })
  })

  describe('editing', () => {
    const ended: Outage = { id: 'e', startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T10:05:00Z', duration: 300 }
    const ongoing: Outage = { id: 'o', startTime: '2024-01-02T10:00:00Z', endTime: null, duration: null }

    it('offers no actions without handlers', () => {
      render(<OutageList outages={[ended]} now={NOW} />)
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    })

    it('marks an outage as not real, and counts it again', () => {
      const onFlag = jest.fn()
      const { rerender } = render(<OutageList outages={[ended]} now={NOW} onFlag={onFlag} />)
      fireEvent.click(screen.getByRole('button', { name: 'Not an outage' }))
      expect(onFlag).toHaveBeenCalledWith('e', true)

      rerender(<OutageList outages={[{ ...ended, flagged: true }]} now={NOW} onFlag={onFlag} />)
      expect(screen.getByText('Not counted')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Count as outage' }))
      expect(onFlag).toHaveBeenLastCalledWith('e', false)
    })

    it('deletes an outage after confirming', () => {
      const onDelete = jest.fn()
      render(<OutageList outages={[ended]} now={NOW} onDelete={onDelete} />)
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      expect(onDelete).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog', { name: 'Delete this outage?' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onDelete).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      const dialog = screen.getByRole('dialog')
      fireEvent.click(Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Delete')!)
      expect(onDelete).toHaveBeenCalledWith('e')
    })

    it('leaves the ongoing outage alone', () => {
      render(<OutageList outages={[ongoing]} now={NOW} onDelete={() => {}} onFlag={() => {}} />)
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Not an outage' })).not.toBeInTheDocument()
    })
  })
})
