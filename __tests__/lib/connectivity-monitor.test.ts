import { MonitorDeps, MonitorSnapshot, createConnectivityMonitor } from '@/lib/connectivity-monitor'
import { FAST_RETRY_MS } from '@/lib/monitor'
import { LEGACY_KEYS, emptyData, loadData, saveData } from '@/lib/storage'
import { TabCoordinator, TabMessage, soloCoordinator } from '@/lib/tab-coordinator'
import { Outage } from '@/types'

const INTERVAL = 60_000
const T0 = Date.parse('2024-01-01T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const stored = () => loadData().data

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

function setup(results: boolean[] | (() => Promise<boolean>), deps: MonitorDeps = {}) {
  const check = typeof results === 'function'
    ? results
    : jest.fn(async () => results.shift() ?? true)
  let n = 0
  const monitor = createConnectivityMonitor({
    check,
    intervalMs: INTERVAL,
    threshold: 2,
    newId: () => `outage-${++n}`,
    detectIsp: async () => null,
    coordinator: soloCoordinator(),
    ...deps,
  })
  return { monitor, check }
}

/**
 * In-memory stand-in for Web Locks + BroadcastChannel shared by several "tabs".
 * Like the real APIs, grants and messages are delivered asynchronously.
 */
function createBrowser() {
  type Waiter = { onAcquired: () => void; cancelled: boolean }
  const queue: Waiter[] = []
  let holder: Waiter | null = null
  const tabs = new Set<Set<(message: TabMessage<MonitorSnapshot>) => void>>()

  const grant = () => {
    if (holder || queue.length === 0) return
    holder = queue.shift()!
    const granted = holder
    void Promise.resolve().then(() => {
      if (!granted.cancelled) granted.onAcquired()
    })
  }

  return {
    tab(): TabCoordinator<MonitorSnapshot> {
      const listeners = new Set<(message: TabMessage<MonitorSnapshot>) => void>()
      tabs.add(listeners)
      return {
        shared: true,
        requestLeadership(onAcquired) {
          const waiter: Waiter = { onAcquired, cancelled: false }
          queue.push(waiter)
          grant()
          return () => {
            waiter.cancelled = true
            if (holder === waiter) {
              holder = null
              grant()
            } else {
              queue.splice(queue.indexOf(waiter), 1)
            }
          }
        },
        post(message) {
          // Messages are copied between tabs, like structured cloning.
          const copy = JSON.parse(JSON.stringify(message))
          for (const other of tabs) {
            if (other === listeners) continue
            void Promise.resolve().then(() => other.forEach(listener => listener(copy)))
          }
        },
        onMessage(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    },
  }
}

const flush = () => jest.advanceTimersByTimeAsync(0)

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

  it('initializes and saves the tracking start time on first start', () => {
    const { monitor } = setup([true])
    monitor.start()
    expect(stored().trackingStartTime).toBe(iso(T0))
    expect(monitor.getSnapshot().loaded).toBe(true)
    expect(monitor.getSnapshot().role).toBe('leader')
  })

  it('checks immediately, then once per interval while up', async () => {
    const { monitor, check } = setup([true, true, true])
    monitor.start()
    await flush()
    expect(check).toHaveBeenCalledTimes(1)
    expect(monitor.getSnapshot().status).toBe('up')

    await jest.advanceTimersByTimeAsync(INTERVAL)
    expect(check).toHaveBeenCalledTimes(2)
    expect(monitor.getSnapshot().nextCheckAt).toBe(T0 + 2 * INTERVAL)
  })

  it('re-checks quickly after a failure and confirms the outage in seconds', async () => {
    const { monitor, check } = setup([true, false, false, true])
    monitor.start()
    await flush() // up
    await jest.advanceTimersByTimeAsync(INTERVAL) // fail #1
    expect(monitor.getSnapshot().nextCheckAt).toBe(T0 + INTERVAL + FAST_RETRY_MS)

    await jest.advanceTimersByTimeAsync(FAST_RETRY_MS) // fail #2: outage confirmed
    expect(monitor.getSnapshot().status).toBe('down')
    expect(stored().outages[0].startTime).toBe(iso(T0 + INTERVAL))

    await jest.advanceTimersByTimeAsync(FAST_RETRY_MS) // recovery noticed quickly too
    expect(check).toHaveBeenCalledTimes(4)
    expect(stored().outages[0].duration).toBe(2 * FAST_RETRY_MS / 1000)
  })

  it('runs a single check when started, stopped and restarted (StrictMode)', async () => {
    const { monitor, check } = setup([true])
    monitor.start()()
    monitor.start()
    await flush()
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('never overlaps checks, even if restarted mid-check', async () => {
    const { check, resolve } = deferredCheck()
    const { monitor } = setup(check)
    const stop = monitor.start()
    await flush()
    expect(monitor.getSnapshot().checking).toBe(true)

    stop()
    monitor.start()
    await flush()
    expect(check).toHaveBeenCalledTimes(1)

    // The old leadership term's result is discarded, and a fresh check runs.
    resolve(true)
    await flush()
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('persists outages, the last check time and the failure streak', async () => {
    const { monitor } = setup([false, false, true])
    monitor.start()
    await flush()
    expect(stored().streak).toEqual({ consecutiveFailures: 1, firstFailureAt: T0, local: false })
    expect(stored().lastCheckAt).toBe(T0)

    await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
    expect(stored().outages).toEqual([
      { id: 'outage-1', startTime: iso(T0), endTime: null, duration: null, cause: 'isp', isp: null },
    ])
  })

  it('records monitored time between checks, but not across gaps', async () => {
    const { monitor } = setup([true, true, true])
    monitor.start()
    await flush()
    await jest.advanceTimersByTimeAsync(INTERVAL)
    expect(Object.values(stored().monitoredByDay)).toEqual([INTERVAL])

    // Simulate the laptop sleeping for an hour: timers pause, the clock doesn't.
    jest.setSystemTime(Date.now() + 60 * 60_000)
    await jest.advanceTimersByTimeAsync(INTERVAL)
    expect(Object.values(stored().monitoredByDay)).toEqual([INTERVAL])
  })

  it('tags outages as local when the device reports no network', async () => {
    const { monitor } = setup([false, false], { deviceOnline: () => false })
    monitor.start()
    await flush()
    await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
    expect(stored().outages[0].cause).toBe('local')
  })

  it('restores an ongoing outage as down before the first check', () => {
    const ongoing: Outage = { id: 'o', startTime: iso(T0 - INTERVAL), endTime: null, duration: null }
    saveData({ ...emptyData(), outages: [ongoing], trackingStartTime: iso(T0 - 10 * INTERVAL), lastCheckAt: T0 - INTERVAL })

    const { monitor } = setup([true])
    monitor.start()
    expect(monitor.getSnapshot().status).toBe('down')
    expect(monitor.getSnapshot().currentOutage).toEqual(ongoing)
  })

  it('saves migrated version 1 data when it takes the lead', () => {
    localStorage.setItem(LEGACY_KEYS.trackingStart, iso(T0 - INTERVAL))
    const { monitor } = setup([true])
    monitor.start()
    expect(localStorage.getItem(LEGACY_KEYS.trackingStart)).toBeNull()
    expect(stored().trackingStartTime).toBe(iso(T0 - INTERVAL))
  })

  describe('checkNow and checkIfOverdue', () => {
    it('checks right away', async () => {
      const { monitor, check } = setup([true, true])
      monitor.start()
      await flush()
      monitor.checkNow()
      await flush()
      expect(check).toHaveBeenCalledTimes(2)
    })

    it('queues one more check if a check is running', async () => {
      const { check, resolve } = deferredCheck()
      const { monitor } = setup(check)
      monitor.start()
      await flush()
      monitor.checkNow()
      monitor.checkNow()
      resolve(true)
      await flush()
      expect(check).toHaveBeenCalledTimes(2)
    })

    it('only checks when overdue', async () => {
      const { monitor, check } = setup([true, true])
      monitor.start()
      await flush()
      monitor.checkIfOverdue()
      await flush()
      expect(check).toHaveBeenCalledTimes(1)

      // Timers were throttled in a background tab: the clock moved, the timer didn't fire.
      jest.setSystemTime(Date.now() + INTERVAL + 1)
      monitor.checkIfOverdue()
      await flush()
      expect(check).toHaveBeenCalledTimes(2)
    })
  })

  describe('ISP detection', () => {
    it('detects on start, stamps outages, and re-detects without the cache after recovery', async () => {
      const detectIsp = jest.fn(async ({ force }: { force: boolean }) => (force ? 'Backup LTE' : 'Comcast'))
      const { monitor } = setup([false, false, true], { detectIsp })
      monitor.start()
      await flush()
      expect(detectIsp).toHaveBeenCalledWith({ force: false })
      expect(monitor.getSnapshot().ispName).toBe('Comcast')

      await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
      expect(stored().outages[0].isp).toBe('Comcast')

      await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
      expect(detectIsp).toHaveBeenLastCalledWith({ force: true })
      expect(monitor.getSnapshot().ispName).toBe('Backup LTE')
    })
  })

  it('reports when an outage is confirmed and when it ends', async () => {
    const onOutageStarted = jest.fn()
    const onOutageEnded = jest.fn()
    const { monitor } = setup([false, false, false, true], { onOutageStarted, onOutageEnded })
    monitor.start()
    await flush()
    expect(onOutageStarted).not.toHaveBeenCalled() // one failure isn't an outage yet
    await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
    expect(onOutageStarted).toHaveBeenCalledWith(expect.objectContaining({ id: 'outage-1', endTime: null }))
    await jest.advanceTimersByTimeAsync(FAST_RETRY_MS) // still down: no repeat
    expect(onOutageStarted).toHaveBeenCalledTimes(1)
    expect(onOutageEnded).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
    // Backdated to the first failure at T0, ended by the success at T0 + 30s.
    expect(onOutageEnded).toHaveBeenCalledWith(expect.objectContaining({ id: 'outage-1', duration: 30 }))
  })

  it('does not announce a recovery for an outage closed by a gap in monitoring', async () => {
    const onOutageEnded = jest.fn()
    const HOUR = 60 * 60_000
    const ongoing: Outage = { id: 'o', startTime: iso(T0 - 4 * HOUR), endTime: null, duration: null }
    // The app was closed an hour into an outage and reopened 3 hours later, still offline.
    saveData({ ...emptyData(), outages: [ongoing], trackingStartTime: iso(T0 - 5 * HOUR), lastCheckAt: T0 - 3 * HOUR })
    const { monitor } = setup([false], { onOutageEnded })
    monitor.start()
    await flush()
    expect(stored().outages[0].endTime).toBe(iso(T0 - 3 * HOUR))
    expect(onOutageEnded).not.toHaveBeenCalled()
  })

  describe('clearHistory', () => {
    it('clears storage, resets to unknown and re-checks right away', async () => {
      const { monitor, check } = setup([false, false, false])
      monitor.start()
      await flush()
      await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
      expect(monitor.getSnapshot().status).toBe('down')

      await jest.advanceTimersByTimeAsync(1000)
      monitor.clearHistory()
      const snapshot = monitor.getSnapshot()
      expect(snapshot.status).toBe('unknown') // not "up" while it's still down
      expect(snapshot.outages).toEqual([])
      expect(snapshot.trackingStartTime).toBe(iso(T0 + FAST_RETRY_MS + 1000))
      expect(stored().outages).toEqual([])

      await flush()
      expect(check).toHaveBeenCalledTimes(3)
    })

    it('resets assumed and recorded monitoring time, so uptime starts over', () => {
      saveData({
        ...emptyData(),
        trackingStartTime: iso(T0 - 392 * 86400_000),
        legacyMonitoredMs: 392 * 86400_000,
        monitoredByDay: { '2024-01-01': 3_600_000 },
      })
      const { monitor } = setup([true])
      monitor.start()
      expect(monitor.getSnapshot().legacyMonitoredMs).toBe(392 * 86400_000)

      monitor.clearHistory()
      expect(stored()).toMatchObject({ legacyMonitoredMs: 0, monitoredByDay: {}, trackingStartTime: iso(T0) })
      expect(monitor.getSnapshot()).toMatchObject({ legacyMonitoredMs: 0, monitoredByDay: {} })
    })

    it('discards a check that was in flight and checks again', async () => {
      const { check, resolve } = deferredCheck()
      const { monitor } = setup(check)
      monitor.start()
      await flush()

      monitor.clearHistory()
      resolve(false)
      await flush()
      expect(check).toHaveBeenCalledTimes(2)
      expect(stored().lastCheckAt).toBeNull()

      resolve(true)
      await flush()
      expect(monitor.getSnapshot().status).toBe('up')
    })
  })

  it('stops checking after stop()', async () => {
    const { monitor, check } = setup([true, true])
    const stop = monitor.start()
    await flush()
    stop()
    await jest.advanceTimersByTimeAsync(5 * INTERVAL)
    expect(check).toHaveBeenCalledTimes(1)
  })

  describe('with several tabs open', () => {
    function twoTabs({ a = [] as boolean[], b = [] as boolean[], deps = {} as MonitorDeps } = {}) {
      const browser = createBrowser()
      const tabA = setup(a, { coordinator: browser.tab(), ...deps })
      const tabB = setup(b, { coordinator: browser.tab(), ...deps })
      return { tabA, tabB }
    }

    it('only the first tab checks; the other mirrors it', async () => {
      const { tabA, tabB } = twoTabs({ a: [true] })
      tabA.monitor.start()
      await flush()
      tabB.monitor.start()
      await flush()

      expect(tabA.monitor.getSnapshot().role).toBe('leader')
      expect(tabB.monitor.getSnapshot().role).toBe('follower')
      expect(tabA.check).toHaveBeenCalledTimes(1)
      expect(tabB.check).not.toHaveBeenCalled()
      expect(tabB.monitor.getSnapshot().status).toBe('up')
      expect(tabB.monitor.getSnapshot().nextCheckAt).toBe(tabA.monitor.getSnapshot().nextCheckAt)
    })

    it('a follower shows stored history before the leader replies', () => {
      saveData({ ...emptyData(), trackingStartTime: iso(T0 - INTERVAL), outages: [
        { id: 'old', startTime: iso(T0 - INTERVAL), endTime: iso(T0 - 1000), duration: 59 },
      ] })
      const { tabB } = twoTabs()
      tabB.monitor.start()
      expect(tabB.monitor.getSnapshot().outages.map(o => o.id)).toEqual(['old'])
    })

    it('clearing history from a follower clears it everywhere', async () => {
      const { tabA, tabB } = twoTabs({ a: [false, false, false] })
      tabA.monitor.start()
      await flush()
      await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
      tabB.monitor.start()
      await flush()
      expect(tabB.monitor.getSnapshot().outages).toHaveLength(1)

      tabB.monitor.clearHistory()
      await flush()
      expect(stored().outages).toEqual([])
      expect(tabA.monitor.getSnapshot().outages).toEqual([])
      expect(tabB.monitor.getSnapshot().outages).toEqual([])
    })

    it('a follower asks the leader to check now', async () => {
      const { tabA, tabB } = twoTabs({ a: [true, true] })
      tabA.monitor.start()
      tabB.monitor.start()
      await flush()
      tabB.monitor.checkNow()
      await flush()
      expect(tabA.check).toHaveBeenCalledTimes(2)
      expect(tabB.check).not.toHaveBeenCalled()
    })

    it('another tab takes over when the leader closes, continuing its failure streak', async () => {
      const { tabA, tabB } = twoTabs({ a: [false], b: [false] })
      const stopA = tabA.monitor.start()
      await flush()
      tabB.monitor.start()
      await flush()
      expect(stored().streak.consecutiveFailures).toBe(1)

      stopA() // the leader's tab closes
      await flush()
      expect(tabB.monitor.getSnapshot().role).toBe('leader')
      expect(tabB.check).toHaveBeenCalledTimes(1)
      // Failure #2 came from the new leader, so the outage is confirmed and backdated to failure #1.
      expect(stored().outages).toHaveLength(1)
      expect(stored().outages[0].startTime).toBe(iso(T0))
    })

    it('only the leader reports outages starting and ending', async () => {
      const onOutageStarted = jest.fn()
      const onOutageEnded = jest.fn()
      const { tabA, tabB } = twoTabs({ a: [false, false, true], deps: { onOutageStarted, onOutageEnded } })
      tabA.monitor.start()
      tabB.monitor.start()
      await flush()
      await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
      await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
      expect(onOutageStarted).toHaveBeenCalledTimes(1)
      expect(onOutageEnded).toHaveBeenCalledTimes(1)
    })
  })
})
