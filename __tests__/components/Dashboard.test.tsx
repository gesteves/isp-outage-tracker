import { fireEvent, render, screen, within } from '@testing-library/react'
import Dashboard from '@/components/Dashboard'
import { UseConnectivityMonitor, useConnectivityMonitor } from '@/hooks/useConnectivityMonitor'
import { WakeLockState, useWakeLock } from '@/hooks/useWakeLock'
import { downloadFile } from '@/lib/download'
import { settingsStore } from '@/lib/settings'

jest.mock('@/hooks/useConnectivityMonitor', () => ({ useConnectivityMonitor: jest.fn() }))
jest.mock('@/hooks/useWakeLock', () => ({ useWakeLock: jest.fn() }))
jest.mock('@/lib/download', () => ({ downloadFile: jest.fn() }))

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
    annotations: [],
    addAnnotation: jest.fn(() => 'note-1'),
    updateAnnotation: jest.fn(() => true),
    deleteAnnotation: jest.fn(),
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
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()

    fireEvent.click(clear)
    expect(screen.getByText(/resetting uptime and monitored time/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear All', hidden: true }))
    expect(state.clearHistory).toHaveBeenCalledTimes(1)
  })

  it('lets you export when there are notes but no outages', () => {
    mockMonitor.mockReturnValue(monitor({ annotations: [{ id: 'note-1', time: '2025-10-12T00:00:00.000Z', text: 'New router' }] }))
    render(<Dashboard />)
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })

  it('offers CSV and Markdown exports', () => {
    const download = downloadFile as jest.MockedFunction<typeof downloadFile>
    download.mockClear()
    mockMonitor.mockReturnValue(monitor({
      annotations: [{ id: 'note-1', time: '2025-10-12T00:00:00.000Z', text: 'New router' }],
      ispName: 'Example ISP',
    }))
    render(<Dashboard />)

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }))
    expect(download).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0][0]).toMatch(/^isp-outages-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(download.mock.calls[0][1].join('')).toContain('"New router"')

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Markdown/ }))
    expect(download).toHaveBeenCalledTimes(2)
    const [name, parts, type] = download.mock.calls[1]
    expect(name).toMatch(/^isp-outage-report-data-\d{4}-\d{2}-\d{2}\.md$/)
    expect(type).toBe('text/markdown;charset=utf-8')
    const md = parts.join('')
    expect(md).toContain('- Current ISP: Example ISP')
    expect(md).toContain('## Daily coverage')
    expect(md).toContain('"New router"')
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

  describe('notes', () => {
    it('adds a note at the date and time entered', () => {
      const state = monitor()
      mockMonitor.mockReturnValue(state)
      render(<Dashboard />)

      fireEvent.click(screen.getByRole('button', { name: 'Add Note' }))
      const dialog = screen.getByRole('dialog', { name: 'Add Note' })
      fireEvent.change(within(dialog).getByLabelText('When'), { target: { value: '2026-11-20T12:00' } })
      fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'Switched routers' } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Note' }))

      expect(state.addAnnotation).toHaveBeenCalledWith({
        time: new Date(2026, 10, 20, 12, 0).getTime(),
        text: 'Switched routers',
      })
      expect(screen.queryByRole('dialog', { name: 'Add Note' })).not.toBeInTheDocument()
    })

    it('edits a note, starting from what it says', () => {
      const note = { id: 'note-1', time: new Date(2026, 10, 20, 12, 0).toISOString(), text: 'Switched routers' }
      const state = monitor({ annotations: [note] })
      mockMonitor.mockReturnValue(state)
      render(<Dashboard />)

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      const dialog = screen.getByRole('dialog', { name: 'Edit Note' })
      expect(within(dialog).getByLabelText('When')).toHaveValue('2026-11-20T12:00')
      expect(within(dialog).getByLabelText('Note')).toHaveValue('Switched routers')
      fireEvent.change(within(dialog).getByLabelText('When'), { target: { value: '2026-11-20T12:15' } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Note' }))

      expect(state.updateAnnotation).toHaveBeenCalledWith('note-1', {
        time: new Date(2026, 10, 20, 12, 15).getTime(),
        text: 'Switched routers',
      })
    })

    it('shows notes in the history even before any outage', () => {
      const note = { id: 'note-1', time: '2026-11-20T12:00:00.000Z', text: 'Switched routers' }
      mockMonitor.mockReturnValue(monitor({ annotations: [note] }))
      render(<Dashboard />)
      expect(screen.getByText('Switched routers', { selector: 'p' })).toBeInTheDocument()
      expect(screen.queryByText('No outages recorded yet.')).not.toBeInTheDocument()
    })
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
