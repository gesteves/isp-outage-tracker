import { StrictMode, ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { useConnectivityMonitor } from '@/hooks/useConnectivityMonitor'
import { checkConnectivity } from '@/lib/connectivity'
import { storage } from '@/lib/storage'

jest.mock('@/lib/connectivity', () => ({ checkConnectivity: jest.fn() }))

const mockCheck = checkConnectivity as jest.MockedFunction<typeof checkConnectivity>
const T0 = Date.parse('2024-01-01T12:00:00Z')
const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>

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
    const { result } = renderHook(() => useConnectivityMonitor({ intervalMs: 60_000, threshold: 2 }), {
      wrapper: strict,
    })

    await act(() => jest.advanceTimersByTimeAsync(0))
    expect(mockCheck).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('unknown')

    await act(() => jest.advanceTimersByTimeAsync(60_000))
    expect(mockCheck).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('down')
    expect(storage.getOutages()).toHaveLength(1)
    expect(result.current.outages).toHaveLength(1)
    expect(result.current.currentOutage?.startTime).toBe(new Date(T0).toISOString())
  })

  it('exposes clearHistory', async () => {
    mockCheck.mockResolvedValue(true)
    const { result } = renderHook(() => useConnectivityMonitor({ intervalMs: 60_000 }))
    await act(() => jest.advanceTimersByTimeAsync(0))
    expect(result.current.status).toBe('up')

    act(() => result.current.clearHistory())
    expect(result.current.status).toBe('unknown')
  })

  it('stops checking on unmount', async () => {
    mockCheck.mockResolvedValue(true)
    const { unmount } = renderHook(() => useConnectivityMonitor({ intervalMs: 60_000 }))
    await act(() => jest.advanceTimersByTimeAsync(0))
    unmount()
    await jest.advanceTimersByTimeAsync(5 * 60_000)
    expect(mockCheck).toHaveBeenCalledTimes(1)
  })
})
