import { fireEvent, render, screen } from '@testing-library/react'
import Dashboard from '@/components/Dashboard'
import { UseConnectivityMonitor, useConnectivityMonitor } from '@/hooks/useConnectivityMonitor'
import { WakeLockState, useWakeLock } from '@/hooks/useWakeLock'
import { settingsStore } from '@/lib/settings'

jest.mock('@/hooks/useConnectivityMonitor', () => ({ useConnectivityMonitor: jest.fn() }))
jest.mock('@/hooks/useWakeLock', () => ({ useWakeLock: jest.fn() }))

const mockMonitor = useConnectivityMonitor as jest.MockedFunction<typeof useConnectivityMonitor>
const mockWakeLock = useWakeLock as jest.MockedFunction<typeof useWakeLock>

function monitor(overrides: Partial<UseConnectivityMonitor> = {}): UseConnectivityMonitor {
  return {
    loaded: true,
    role: 'leader',
    following: false,
    leaderUnresponsive: false,
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
    deleteOutage: jest.fn(),
    setOutageFlagged: jest.fn(),
    ...overrides,
  }
}

function wakeLock(overrides: Partial<WakeLockState> = {}): WakeLockState {
  return { supported: false, active: false, error: null, retry: jest.fn(), ...overrides }
}

describe('Dashboard', () => {
  beforeEach(() => {
    mockWakeLock.mockReturnValue(wakeLock())
    settingsStore.set({ keepScreenOn: false, notifyOnStatusChange: false })
  })

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

  it('does not claim there are no outages before the history has loaded', () => {
    // This is what the prerendered static HTML shows.
    mockMonitor.mockReturnValue(monitor({ loaded: false, trackingStartTime: null }))
    render(<Dashboard />)
    expect(screen.queryByText('No outages recorded yet.')).not.toBeInTheDocument()
    expect(screen.getByText('Loading history…')).toBeInTheDocument()
  })

  describe('which tab is monitoring', () => {
    it('says nothing while waiting to find out', () => {
      mockMonitor.mockReturnValue(monitor({ role: 'follower', following: false }))
      render(<Dashboard />)
      expect(screen.queryByText(/another tab/)).not.toBeInTheDocument()
    })

    it('says so when another tab is monitoring', () => {
      mockMonitor.mockReturnValue(monitor({ role: 'follower', following: true }))
      render(<Dashboard />)
      expect(screen.getByText(/Monitoring in another tab/)).toBeInTheDocument()
    })

    it('says so when that tab stopped responding', () => {
      mockMonitor.mockReturnValue(monitor({ role: 'follower', following: true, leaderUnresponsive: true }))
      render(<Dashboard />)
      expect(screen.getByText(/isn’t responding, taking over/)).toBeInTheDocument()
      expect(screen.queryByText(/Monitoring in another tab/)).not.toBeInTheDocument()
    })
  })

  it('checks now on request', () => {
    const state = monitor({ nextCheckAt: Date.now() + 30_000 })
    mockMonitor.mockReturnValue(state)
    render(<Dashboard />)
    expect(screen.getByText(/Next check in 30s/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(state.checkNow).toHaveBeenCalledTimes(1)
  })

  describe('keep screen on', () => {
    it('turns off even while the browser is refusing it, with retrying kept separate', () => {
      const retry = jest.fn()
      mockWakeLock.mockReturnValue(wakeLock({ supported: true, error: 'The browser didn’t allow it.', retry }))
      mockMonitor.mockReturnValue(monitor())
      settingsStore.set({ keepScreenOn: true })
      render(<Dashboard />)

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(retry).toHaveBeenCalledTimes(1)
      const toggle = screen.getByRole('switch', { name: 'Keep screen on' })
      expect(toggle).toHaveAttribute('aria-checked', 'true')

      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-checked', 'false')
      expect(settingsStore.get().keepScreenOn).toBe(false)
      expect(retry).toHaveBeenCalledTimes(1)
    })
  })
})
