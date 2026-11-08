import { StrictMode, ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { useConnectivityMonitor } from '@/hooks/useConnectivityMonitor'
import { checkConnectivity } from '@/lib/connectivity'
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

  it('re-checks immediately when the browser reports a network change', async () => {
    mockCheck.mockResolvedValue(true)
    renderHook(() => useConnectivityMonitor(deps))
    await act(() => jest.advanceTimersByTimeAsync(0))
    expect(mockCheck).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event('offline'))
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(mockCheck).toHaveBeenCalledTimes(2)

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(mockCheck).toHaveBeenCalledTimes(3)
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
