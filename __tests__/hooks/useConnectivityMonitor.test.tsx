import { StrictMode, ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { useConnectivityMonitor } from '@/hooks/useConnectivityMonitor'
import { checkConnectivity } from '@/lib/connectivity'
import { RECONNECT_SETTLE_MS } from '@/lib/connectivity-monitor'
import { FAST_RETRY_MS } from '@/lib/monitor'
import { loadData } from '@/lib/storage'

jest.mock('@/lib/connectivity', () => ({ checkConnectivity: jest.fn() }))

const mockCheck = checkConnectivity as jest.MockedFunction<typeof checkConnectivity>
const T0 = Date.parse('2024-01-01T12:00:00Z')
const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
const deps = { intervalMs: 60_000, threshold: 2, detectIsp: async () => null }

describe('useConnectivityMonitor', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 })
    mockCheck.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('runs one check and records one outage under StrictMode', async () => {
    mockCheck.mockResolvedValue(false)
    const { result } = renderHook(() => useConnectivityMonitor(deps), { wrapper: strict })

    await act(() => jest.advanceTimersByTimeAsync(0))
    expect(mockCheck).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('unknown')

    await act(() => jest.advanceTimersByTimeAsync(FAST_RETRY_MS))
    expect(mockCheck).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('down')
    expect(loadData().data.outages).toHaveLength(1)
    expect(result.current.outages).toHaveLength(1)
    expect(result.current.currentOutage?.startTime).toBe(new Date(T0).toISOString())
  })

  it('leads on its own when tabs cannot coordinate (no Web Locks in jsdom)', async () => {
    mockCheck.mockResolvedValue(true)
    const { result } = renderHook(() => useConnectivityMonitor(deps))
    await act(() => jest.advanceTimersByTimeAsync(0))
    expect(result.current.role).toBe('leader')
  })

  it('exposes clearHistory', async () => {
    mockCheck.mockResolvedValue(true)
    const { result } = renderHook(() => useConnectivityMonitor(deps))
    await act(() => jest.advanceTimersByTimeAsync(0))
    expect(result.current.status).toBe('up')

    act(() => result.current.clearHistory())
    expect(result.current.status).toBe('unknown')
  })

  it('re-checks when the browser reports a network change, giving a reconnect a moment', async () => {
    mockCheck.mockResolvedValue(true)
    renderHook(() => useConnectivityMonitor(deps))
    await act(() => jest.advanceTimersByTimeAsync(0))
    expect(mockCheck).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event('offline'))
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(mockCheck).toHaveBeenCalledTimes(2)

    // Checking the instant the network is back could fail and count a local outage against the ISP.
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await jest.advanceTimersByTimeAsync(RECONNECT_SETTLE_MS - 1)
    })
    expect(mockCheck).toHaveBeenCalledTimes(2)
    await act(() => jest.advanceTimersByTimeAsync(1))
    expect(mockCheck).toHaveBeenCalledTimes(3)
  })

  it('a local outage stays local when the device reconnects', async () => {
    let deviceOnline = false
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => deviceOnline })
    try {
      mockCheck.mockResolvedValue(false)
      const { result } = renderHook(() => useConnectivityMonitor(deps))
      await act(() => jest.advanceTimersByTimeAsync(0))
      await act(() => jest.advanceTimersByTimeAsync(FAST_RETRY_MS))
      expect(result.current.currentOutage?.cause).toBe('local')

      // Wi-Fi is back, but requests fail for a moment while it reconnects.
      deviceOnline = true
      await act(async () => {
        window.dispatchEvent(new Event('online'))
        await jest.advanceTimersByTimeAsync(0)
      })
      mockCheck.mockResolvedValue(true)
      await act(() => jest.advanceTimersByTimeAsync(RECONNECT_SETTLE_MS))
      expect(result.current.status).toBe('up')
      expect(result.current.outages[0].cause).toBe('local')
    } finally {
      delete (navigator as { onLine?: boolean }).onLine
    }
  })

  it('stops checking and listening on unmount', async () => {
    mockCheck.mockResolvedValue(true)
    const { unmount } = renderHook(() => useConnectivityMonitor(deps))
    await act(() => jest.advanceTimersByTimeAsync(0))
    unmount()
    window.dispatchEvent(new Event('online'))
    await jest.advanceTimersByTimeAsync(5 * 60_000)
    expect(mockCheck).toHaveBeenCalledTimes(1)
  })
})
