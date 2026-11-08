import { createConnectivityMonitor } from '@/lib/connectivity-monitor'
import { storage } from '@/lib/storage'
import { Outage } from '@/types'

const INTERVAL = 60_000
const T0 = Date.parse('2024-01-01T12:00:00Z')

/** A check whose result the test resolves by hand, to simulate in-flight checks. */
function deferredCheck() {
  const resolvers: Array<(online: boolean) => void> = []
  const check = jest.fn(
    () => new Promise<boolean>(resolve => {
      resolvers.push(resolve)
    }),
  )
  return { check, resolve: (online: boolean) => resolvers.shift()!(online) }
}

function setup(results: boolean[] | (() => Promise<boolean>)) {
  const check = typeof results === 'function'
    ? results
    : jest.fn(async () => results.shift() ?? true)
  let n = 0
  const monitor = createConnectivityMonitor({
    check,
    intervalMs: INTERVAL,
    threshold: 2,
    newId: () => `outage-${++n}`,
  })
  return { monitor, check }
}

describe('createConnectivityMonitor', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('returns an empty, unloaded snapshot before start (server render)', () => {
    const { monitor } = setup([])
    expect(monitor.getSnapshot()).toBe(monitor.getServerSnapshot())
    expect(monitor.getSnapshot().loaded).toBe(false)
  })

  it('initializes the tracking start time on first start', () => {
    const { monitor } = setup([true])
    monitor.start()
    expect(storage.getTrackingStartTime()).toBe(new Date(T0).toISOString())
    expect(monitor.getSnapshot().loaded).toBe(true)
  })

  it('checks immediately, then once per interval', async () => {
    const { monitor, check } = setup([true, true, true])
    monitor.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(check).toHaveBeenCalledTimes(1)
    expect(monitor.getSnapshot().status).toBe('up')

    await jest.advanceTimersByTimeAsync(INTERVAL)
    expect(check).toHaveBeenCalledTimes(2)
    expect(monitor.getSnapshot().nextCheckAt).toBe(T0 + 2 * INTERVAL)
  })

  it('runs a single check when started, stopped and restarted (StrictMode)', async () => {
    const { monitor, check } = setup([true])
    monitor.start()()
    monitor.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('never overlaps checks, even if restarted mid-check', async () => {
    const { check, resolve } = deferredCheck()
    const { monitor } = setup(check)
    const stop = monitor.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(monitor.getSnapshot().checking).toBe(true)

    stop()
    monitor.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(check).toHaveBeenCalledTimes(1)

    resolve(true)
    await jest.advanceTimersByTimeAsync(0)
    expect(monitor.getSnapshot().checking).toBe(false)
    expect(monitor.getSnapshot().nextCheckAt).toBe(T0 + INTERVAL)
  })

  it('records one outage backdated to the first failure, then ends it', async () => {
    const { monitor } = setup([false, false, false, true])
    monitor.start()
    await jest.advanceTimersByTimeAsync(0) // fail #1 at T0
    expect(monitor.getSnapshot().status).toBe('unknown')

    await jest.advanceTimersByTimeAsync(INTERVAL) // fail #2: outage starts
    expect(monitor.getSnapshot().status).toBe('down')
    expect(storage.getOutages()).toEqual([
      { id: 'outage-1', startTime: new Date(T0).toISOString(), endTime: null, duration: null },
    ])

    await jest.advanceTimersByTimeAsync(INTERVAL) // fail #3: still the same outage
    await jest.advanceTimersByTimeAsync(INTERVAL) // success: outage ends
    const outages = storage.getOutages()
    expect(outages).toHaveLength(1)
    expect(outages[0].endTime).toBe(new Date(T0 + 3 * INTERVAL).toISOString())
    expect(outages[0].duration).toBe(180)
    expect(monitor.getSnapshot().outages).toEqual(outages)
    expect(monitor.getSnapshot().status).toBe('up')
  })

  it('persists the last check time', async () => {
    const { monitor } = setup([true])
    monitor.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(storage.getLastCheckAt()).toBe(T0)
    expect(monitor.getSnapshot().lastCheckAt).toBe(T0)
  })

  it('restores an ongoing outage as down before the first check', () => {
    const ongoing: Outage = {
      id: 'o', startTime: new Date(T0 - INTERVAL).toISOString(), endTime: null, duration: null,
    }
    storage.setOutages([ongoing])
    storage.setTrackingStartTime(new Date(T0 - 10 * INTERVAL).toISOString())
    storage.setLastCheckAt(T0 - INTERVAL)

    const { monitor } = setup([true])
    monitor.start()
    expect(monitor.getSnapshot().status).toBe('down')
    expect(monitor.getSnapshot().currentOutage).toEqual(ongoing)
  })

  it('removes phantom open outages on load', () => {
    storage.setOutages([
      { id: 'phantom', startTime: new Date(T0 - 2 * INTERVAL).toISOString(), endTime: null, duration: null },
      {
        id: 'real',
        startTime: new Date(T0 - INTERVAL).toISOString(),
        endTime: new Date(T0).toISOString(),
        duration: 60,
      },
    ])
    const { monitor } = setup([true])
    monitor.start()
    expect(storage.getOutages().map(o => o.id)).toEqual(['real'])
    expect(monitor.getSnapshot().currentOutage).toBeNull()
  })

  describe('clearHistory', () => {
    it('clears storage, resets to unknown and re-checks right away', async () => {
      const { monitor, check } = setup([false, false, false])
      monitor.start()
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(INTERVAL)
      expect(monitor.getSnapshot().status).toBe('down')

      await jest.advanceTimersByTimeAsync(1000)
      monitor.clearHistory()
      const snapshot = monitor.getSnapshot()
      expect(snapshot.status).toBe('unknown') // not "up" while it's still down
      expect(snapshot.outages).toEqual([])
      expect(snapshot.trackingStartTime).toBe(new Date(T0 + INTERVAL + 1000).toISOString())
      expect(storage.getOutages()).toEqual([])

      await jest.advanceTimersByTimeAsync(0)
      expect(check).toHaveBeenCalledTimes(3)
    })

    it('discards a check that was in flight and checks again', async () => {
      const { check, resolve } = deferredCheck()
      const { monitor } = setup(check)
      monitor.start()
      await jest.advanceTimersByTimeAsync(0)

      monitor.clearHistory()
      resolve(false)
      await jest.advanceTimersByTimeAsync(0)
      expect(check).toHaveBeenCalledTimes(2)
      expect(storage.getLastCheckAt()).toBeNull()

      resolve(true)
      await jest.advanceTimersByTimeAsync(0)
      expect(monitor.getSnapshot().status).toBe('up')
    })
  })

  it('stops checking after stop()', async () => {
    const { monitor, check } = setup([true, true])
    const stop = monitor.start()
    await jest.advanceTimersByTimeAsync(0)
    stop()
    await jest.advanceTimersByTimeAsync(5 * INTERVAL)
    expect(check).toHaveBeenCalledTimes(1)
  })
})
