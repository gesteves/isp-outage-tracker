import { render, screen } from '@testing-library/react'
import StatusIndicator from '@/components/StatusIndicator'

describe('StatusIndicator', () => {
  it('should show "up" when online', () => {
    render(<StatusIndicator status="up" />)

    expect(screen.getByText(/Your internet is/)).toBeInTheDocument()
    expect(screen.getByText('up')).toBeInTheDocument()
  })

  it('should show "down" when offline', () => {
    render(<StatusIndicator status="down" />)

    expect(screen.getByText(/Your internet is/)).toBeInTheDocument()
    expect(screen.getByText('down')).toBeInTheDocument()
  })

  it('should show a checking state before the first result', () => {
    const { container } = render(<StatusIndicator status="unknown" />)

    expect(screen.getByText('Checking your connection…')).toBeInTheDocument()
    expect(screen.queryByText(/Your internet is/)).not.toBeInTheDocument()
    expect(container.querySelector('.bg-gray-300')).toBeInTheDocument()
  })

  it('should show outage duration when provided', () => {
    render(<StatusIndicator status="down" currentOutageDuration={125} />)

    expect(screen.getByText(/been down for/)).toBeInTheDocument()
    expect(screen.getByText(/2m 5s/)).toBeInTheDocument()
  })

  it('should not show duration when online', () => {
    render(<StatusIndicator status="up" currentOutageDuration={100} />)

    expect(screen.queryByText(/been down for/)).not.toBeInTheDocument()
  })

  it('should apply correct styling for online state', () => {
    const { container } = render(<StatusIndicator status="up" />)

    expect(container.querySelector('.bg-green-500')).toBeInTheDocument()
  })

  it('should apply correct styling for offline state', () => {
    const { container } = render(<StatusIndicator status="down" />)

    expect(container.querySelector('.bg-red-500')).toBeInTheDocument()
  })
})
