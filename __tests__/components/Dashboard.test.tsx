import { fireEvent, render, screen } from '@testing-library/react'
import Dashboard from '@/components/Dashboard'
import { UseConnectivityMonitor, useConnectivityMonitor } from '@/hooks/useConnectivityMonitor'

jest.mock('@/hooks/useConnectivityMonitor', () => ({ useConnectivityMonitor: jest.fn() }))

const mockMonitor = useConnectivityMonitor as jest.MockedFunction<typeof useConnectivityMonitor>

function monitor(overrides: Partial<UseConnectivityMonitor> = {}): UseConnectivityMonitor {
  return {
    loaded: true,
    role: 'leader',
    status: 'up',
    outages: [],
    trackingStartTime: '2025-10-11T00:00:00.000Z',
    currentOutage: null,
    lastCheckAt: null,
    nextCheckAt: null,
    checking: false,
    ispName: null,
    monitoredByDay: {},
    legacyMonitoredMs: 392 * 86400 * 1000,
    clearHistory: jest.fn(),
    checkNow: jest.fn(),
    ...overrides,
  }
}

describe('Dashboard', () => {
  it('lets you reset tracking even when no outages were logged', () => {
    const state = monitor()
    mockMonitor.mockReturnValue(state)
    render(<Dashboard />)

    const clear = screen.getByRole('button', { name: 'Clear Logs' })
    expect(clear).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()

    fireEvent.click(clear)
    expect(screen.getByText(/resetting uptime and monitored time/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear All', hidden: true }))
    expect(state.clearHistory).toHaveBeenCalledTimes(1)
  })

  it('has nothing to reset before tracking starts', () => {
    mockMonitor.mockReturnValue(monitor({ loaded: false, trackingStartTime: null }))
    render(<Dashboard />)
    expect(screen.getByRole('button', { name: 'Clear Logs' })).toBeDisabled()
  })
})
