import { act, renderHook } from '@testing-library/react'
import { useWakeLock } from '@/hooks/useWakeLock'

class FakeSentinel extends EventTarget {
  released = false
  release = jest.fn(async () => {
    if (this.released) return
    this.released = true
    this.dispatchEvent(new Event('release'))
  })
}

let visibility: DocumentVisibilityState = 'visible'
let sentinels: FakeSentinel[] = []
const request = jest.fn()

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

beforeEach(() => {
  visibility = 'visible'
  sentinels = []
  request.mockReset().mockImplementation(async () => {
    const sentinel = new FakeSentinel()
    sentinels.push(sentinel)
    return sentinel
  })
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
})

afterEach(() => {
  delete (navigator as { wakeLock?: unknown }).wakeLock
})

describe('useWakeLock', () => {
  it('reports unsupported browsers', () => {
    delete (navigator as { wakeLock?: unknown }).wakeLock
    const { result } = renderHook(() => useWakeLock(true))
    expect(result.current.supported).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('does nothing while disabled', () => {
    const { result } = renderHook(() => useWakeLock(false))
    expect(result.current.supported).toBe(true)
    expect(result.current.active).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps the screen on while enabled, and releases when disabled', async () => {
    const { result, rerender } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: true } })
    await act(async () => {})
    expect(request).toHaveBeenCalledWith('screen')
    expect(result.current.active).toBe(true)

    rerender({ on: false })
    await act(async () => {})
    expect(sentinels[0].release).toHaveBeenCalled()
    expect(result.current.active).toBe(false)
  })

  it('asks again when the page becomes visible after the browser dropped the lock', async () => {
    const { result } = renderHook(() => useWakeLock(true))
    await act(async () => {})

    // The browser releases the lock when the page is hidden.
    await act(async () => {
      setVisibility('hidden')
      await sentinels[0].release()
    })
    expect(result.current.active).toBe(false)

    await act(async () => {
      setVisibility('visible')
    })
    expect(request).toHaveBeenCalledTimes(2)
    expect(result.current.active).toBe(true)
  })

  it('does not request while the page is hidden', async () => {
    visibility = 'hidden'
    renderHook(() => useWakeLock(true))
    await act(async () => {})
    expect(request).not.toHaveBeenCalled()
  })

  it('explains a refusal and can retry', async () => {
    request.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NotAllowedError' }))
    const { result } = renderHook(() => useWakeLock(true))
    await act(async () => {})
    expect(result.current.active).toBe(false)
    expect(result.current.error).toMatch(/didn’t allow/)

    await act(async () => {
      result.current.retry()
    })
    expect(result.current.active).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('forgets a refusal once turned off, so it does not show again on re-enable', async () => {
    request.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NotAllowedError' }))
    // The next request stays pending, as if the browser were still deciding.
    const { result, rerender } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: true } })
    await act(async () => {})
    expect(result.current.error).not.toBeNull()

    rerender({ on: false })
    request.mockImplementationOnce(() => new Promise(() => {}))
    rerender({ on: true })
    expect(result.current.error).toBeNull()
  })

  it('releases on unmount', async () => {
    const { unmount } = renderHook(() => useWakeLock(true))
    await act(async () => {})
    unmount()
    expect(sentinels[0].release).toHaveBeenCalled()
  })
})
