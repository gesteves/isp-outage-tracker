import { render, screen } from '@testing-library/react'
import StatusIndicator from '@/components/StatusIndicator'

describe('StatusIndicator', () => {
  it('should show "Internet is UP" when online', () => {
    render(<StatusIndicator isOnline={true} />)
    
    expect(screen.getByText('Internet is UP')).toBeInTheDocument()
  })

  it('should show "Internet is DOWN" when offline', () => {
    render(<StatusIndicator isOnline={false} />)
    
    expect(screen.getByText('Internet is DOWN')).toBeInTheDocument()
  })

  it('should show outage duration when provided', () => {
    render(<StatusIndicator isOnline={false} currentOutageDuration={125} />)
    
    expect(screen.getByText(/Down for/)).toBeInTheDocument()
    expect(screen.getByText(/2m 5s/)).toBeInTheDocument()
  })

  it('should not show duration when online', () => {
    render(<StatusIndicator isOnline={true} currentOutageDuration={100} />)
    
    expect(screen.queryByText(/Down for/)).not.toBeInTheDocument()
  })

  it('should apply correct styling for online state', () => {
    const { container } = render(<StatusIndicator isOnline={true} />)
    
    const statusCircle = container.querySelector('.bg-green-500')
    expect(statusCircle).toBeInTheDocument()
  })

  it('should apply correct styling for offline state', () => {
    const { container } = render(<StatusIndicator isOnline={false} />)
    
    const statusCircle = container.querySelector('.bg-red-500')
    expect(statusCircle).toBeInTheDocument()
  })
})

