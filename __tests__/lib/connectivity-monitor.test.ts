import { CheckOutcome } from '@/lib/connectivity'
import { NetworkInfo } from '@/lib/isp-detection'
import { MonitorDeps, MonitorSnapshot, createConnectivityMonitor } from '@/lib/connectivity-monitor'
import { FAST_RETRY_MS, gapThresholdMs } from '@/lib/monitor'
import { LEGACY_KEYS, emptyData, loadData, readEpoch, saveData } from '@/lib/storage'
import { LeadershipCallbacks, TabCoordinator, TabMessage, soloCoordinator } from '@/lib/tab-coordinator'
import { Outage } from '@/types'

const INTERVAL = 60_000
const T0 = Date.parse('2024-01-01T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const stored = () => loadData().data
const network = (name: string, ip: string | null = null, asn: string | null = null): NetworkInfo => ({ name, ip, asn })

/** Tests mostly only care whether a check passed: a bare boolean stands for that. */
type Result = boolean | CheckOutcome
const toOutcome = (result: Result): CheckOutcome =>
  typeof result === 'boolean' ? { online: result, latencyMs: null } : result

/** A check whose result the test resolves by hand, to simulate in-flight checks. */
function deferredCheck() {
  const resolvers: Array<(result: Result) => void> = []
  const check = jest.fn(
    () => new Promise<Result>(resolve => {
      resolvers.push(resolve)
    }),
  )
  return { check, resolve: (result: Result) => resolvers.shift()!(result) }
}

function setup(results: Result[] | (() => Promise<Result>), deps: MonitorDeps = {}) {
  const check = typeof results === 'function'
    ? results
    : jest.fn(async () => results.shift() ?? true)
  let n = 0
  const monitor = createConnectivityMonitor({
    check: async () => toOutcome(await check()),
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
  type Waiter = LeadershipCallbacks & { cancelled: boolean }
  const queue: Waiter[] = []
  let holder: Waiter | null = null
  const tabs = new Set<Set<(message: TabMessage<MonitorSnapshot>) => void>>()
  /** A suspended tab doesn't hear that its lock was taken over until it runs again. */
  let deliverLost = true
  const pendingLost: Waiter[] = []

  const grant = () => {
    if (holder || queue.length === 0) return
    holder = queue.shift()!
    const granted = holder
    void Promise.resolve().then(() => {
      if (!granted.cancelled) granted.onAcquired()
    })
  }

  return {
    suspendLostNotices() {
      deliverLost = false
    },
    deliverLostNotices() {
      pendingLost.splice(0).forEach(waiter => waiter.onLost())
    },
    tab(): TabCoordinator<MonitorSnapshot> {
      const listeners = new Set<(message: TabMessage<MonitorSnapshot>) => void>()
      tabs.add(listeners)
      return {
        shared: true,
        requestLeadership(callbacks) {
          const waiter: Waiter = { ...callbacks, cancelled: false }
          queue.push(waiter)
          grant()
          return {
            release() {
              waiter.cancelled = true
              if (holder === waiter) {
                holder = null
                grant()
              } else if (queue.includes(waiter)) {
                queue.splice(queue.indexOf(waiter), 1)
              }
            },
            takeOver() {
              if (waiter.cancelled || holder === waiter) return
              if (queue.includes(waiter)) queue.splice(queue.indexOf(waiter), 1)
              const previous = holder
              holder = waiter
              void Promise.resolve().then(() => waiter.onAcquired())
              if (!previous) return
              queue.push(previous) // it waits in line to lead again
              if (deliverLost) void Promise.resolve().then(() => previous.onLost())
              else pendingLost.push(previous)
            },
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
      {
        id: 'outage-1',
        startTime: iso(T0),
        endTime: null,
        duration: null,
        cause: 'isp',
        isp: null,
        ip: null,
        asn: null,
        checkIntervalSeconds: 60,
        failureThreshold: 2,
        latencyBeforeMs: null,
      },
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

  describe('checkSoon', () => {
    it('waits the given delay when that is sooner than the next check', async () => {
      const { monitor, check } = setup([true, true])
      monitor.start()
      await flush()
      monitor.checkSoon(2000)
      expect(monitor.getSnapshot().nextCheckAt).toBe(T0 + 2000)
      await jest.advanceTimersByTimeAsync(1999)
      expect(check).toHaveBeenCalledTimes(1)
      await jest.advanceTimersByTimeAsync(1)
      expect(check).toHaveBeenCalledTimes(2)
    })

    it('never puts off a check that is due sooner', async () => {
      const { monitor } = setup([true])
      monitor.start()
      await flush()
      await jest.advanceTimersByTimeAsync(INTERVAL - 1000)
      monitor.checkSoon(2000)
      expect(monitor.getSnapshot().nextCheckAt).toBe(T0 + INTERVAL)
    })

    it('checks that long after a check that is running', async () => {
      const { check, resolve } = deferredCheck()
      const { monitor } = setup(check)
      monitor.start()
      await flush()
      monitor.checkSoon(2000)
      resolve(true)
      await flush()
      expect(monitor.getSnapshot().nextCheckAt).toBe(T0 + 2000)
    })
  })

  it('counts a failure as local if the device lost its network during the check', async () => {
    let deviceOnline = true
    const check = jest.fn(async () => {
      deviceOnline = false // e.g. Wi-Fi dropped while the requests were out
      return false
    })
    const { monitor } = setup(check, { deviceOnline: () => deviceOnline })
    monitor.start()
    await flush()
    expect(stored().streak.local).toBe(true)
    await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
    expect(stored().outages[0].cause).toBe('local')
  })

  describe('ISP detection', () => {
    it('detects on start, stamps outages, and re-detects without the cache after recovery', async () => {
      const detectIsp = jest.fn(async ({ force }: { force: boolean }) => network(force ? 'Backup LTE' : 'Comcast'))
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

    it('records the network before an outage, and what it is right after', async () => {
      const detectIsp = jest.fn(async ({ force }: { force: boolean }) =>
        force ? network('Backup LTE', '198.51.100.2', 'AS21928') : network('Comcast', '203.0.113.7', 'AS7922'),
      )
      const { monitor } = setup([false, false, true], { detectIsp })
      monitor.start()
      await flush()
      await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
      expect(stored().outages[0]).toMatchObject({ isp: 'Comcast', ip: '203.0.113.7', asn: 'AS7922' })
      expect(stored().outages[0]).not.toHaveProperty('ipAfter')

      await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
      expect(stored().outages[0]).toMatchObject({
        endReason: 'restored',
        ispAfter: 'Backup LTE',
        ipAfter: '198.51.100.2',
        asnAfter: 'AS21928',
      })
      expect(monitor.getSnapshot().outages[0].ipAfter).toBe('198.51.100.2')
    })

    it('leaves the network after blank when it cannot be detected', async () => {
      const detectIsp = jest.fn(async ({ force }: { force: boolean }) => (force ? null : network('Comcast')))
      const { monitor } = setup([false, false, true], { detectIsp })
      monitor.start()
      await flush()
      await jest.advanceTimersByTimeAsync(2 * FAST_RETRY_MS)
      expect(stored().outages[0].endTime).not.toBeNull()
      expect(stored().outages[0]).not.toHaveProperty('ispAfter')
      expect(monitor.getSnapshot().ispName).toBe('Comcast')
    })
  })

  it('records response times, and keeps them for the next tab or reload', async () => {
    const { monitor } = setup([
      { online: true, latencyMs: 30 },
      { online: true, latencyMs: 50 },
      { online: false, failure: 'dns', latencyMs: 12 },
      { online: false, failure: 'dns', latencyMs: 12 },
      { online: true, latencyMs: 70 },
    ])
    monitor.start()
    await flush()
    await jest.advanceTimersByTimeAsync(INTERVAL)
    expect(stored().recentLatencies).toEqual([30, 50])

    await jest.advanceTimersByTimeAsync(INTERVAL + FAST_RETRY_MS)
    expect(stored().outages[0]).toMatchObject({ failure: 'dns', latencyBeforeMs: 40 })
    expect(stored().streak.failure).toBe('dns')

    await jest.advanceTimersByTimeAsync(FAST_RETRY_MS)
    expect(stored().outages[0]).toMatchObject({ endReason: 'restored', latencyAfterMs: 70 })
    expect(stored().recentLatencies).toEqual([30, 50, 70])
  })

  it('keeps the ISP name current in a long session, using the hour-long cache', async () => {
    const detectIsp = jest.fn<Promise<NetworkInfo | null>, [{ force: boolean }]>(async () => network('Comcast'))
    const { monitor } = setup([true, true], { detectIsp })
    monitor.start()
    await flush()
    await jest.advanceTimersByTimeAsync(INTERVAL)
    // On taking the lead, then after each successful check, never skipping the cache.
    expect(detectIsp).toHaveBeenCalledTimes(3)
    expect(detectIsp.mock.calls.every(([options]) => options.force === false)).toBe(true)
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
    expect(stored().outages[0].endReason).toBe('gap')
    expect(onOutageEnded).not.toHaveBeenCalled()
  })

  it('does not record the network after on an outage closed by a gap', async () => {
    const HOUR = 60 * 60_000
    const ongoing: Outage = { id: 'o', startTime: iso(T0 - 4 * HOUR), endTime: null, duration: null }
    saveData({ ...emptyData(), outages: [ongoing], trackingStartTime: iso(T0 - 5 * HOUR), lastCheckAt: T0 - 3 * HOUR })
    const detectIsp = jest.fn(async () => network('Comcast', '203.0.113.7'))
    const { monitor } = setup([true], { detectIsp })
    monitor.start()
    await flush()
    expect(detectIsp).toHaveBeenLastCalledWith({ force: true })
    expect(stored().outages[0].endReason).toBe('gap')
    expect(stored().outages[0]).not.toHaveProperty('ipAfter')
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

  describe('editing outages', () => {
    const ended: Outage = { id: 'old', startTime: iso(T0 - 2 * INTERVAL), endTime: iso(T0 - INTERVAL), duration: 60 }
    const ongoing: Outage = { id: 'now', startTime: iso(T0 - 1000), endTime: null, duration: null }

    beforeEach(() => {
      saveData({ ...emptyData(), trackingStartTime: iso(T0 - 10 * INTERVAL), outages: [ended, ongoing], lastCheckAt: T0 - 1000 })
    })

    it('flags an outage that has ended as not real, and unflags it', () => {
      const { monitor } = setup([false])
      monitor.start()
      monitor.setOutageFlagged('old', true)
      expect(stored().outages[0]).toEqual({ ...ended, flagged: true })
      expect(monitor.getSnapshot().outages[0].flagged).toBe(true)

      monitor.setOutageFlagged('old', false)
      expect(stored().outages[0]).toEqual(ended)
    })

    it('deletes an outage that has ended', () => {
      const { monitor } = setup([false])
      monitor.start()
      monitor.deleteOutage('old')
      expect(stored().outages.map(o => o.id)).toEqual(['now'])
      expect(monitor.getSnapshot().outages.map(o => o.id)).toEqual(['now'])
    })

    it('leaves the ongoing outage alone', () => {
      const { monitor } = setup([false])
      monitor.start()
      monitor.deleteOutage('now')
      monitor.setOutageFlagged('now', true)
      expect(stored().outages[1]).toEqual(ongoing)
    })
  })

  describe('notes', () => {
    const NOON = Date.parse('2024-01-01T11:00:00Z')

    function noteSetup() {
      let n = 0
      return setup([true], { newAnnotationId: () => `note-${++n}` })
    }

    it('adds, edits and deletes notes, saving each change', () => {
      const { monitor } = noteSetup()
      monitor.start()

      expect(monitor.addAnnotation({ time: NOON, text: ' Switched routers ' })).toBe('note-1')
      const saved = { id: 'note-1', time: iso(NOON), text: 'Switched routers' }
      expect(stored().annotations).toEqual([saved])
      expect(monitor.getSnapshot().annotations).toEqual([saved])

      expect(monitor.addAnnotation({ time: iso(NOON - INTERVAL), text: 'Unplugged the modem' })).toBe('note-2')
      expect(stored().annotations.map(a => a.id)).toEqual(['note-2', 'note-1'])

      expect(monitor.updateAnnotation('note-1', { time: NOON - 2 * INTERVAL, text: 'New router' })).toBe(true)
      expect(stored().annotations).toEqual([
        { id: 'note-1', time: iso(NOON - 2 * INTERVAL), text: 'New router' },
        { id: 'note-2', time: iso(NOON - INTERVAL), text: 'Unplugged the modem' },
      ])

      monitor.deleteAnnotation('note-2')
      expect(stored().annotations.map(a => a.id)).toEqual(['note-1'])
      expect(monitor.getSnapshot().annotations.map(a => a.id)).toEqual(['note-1'])
    })

    it('refuses notes without text or a valid time', () => {
      const { monitor } = noteSetup()
      monitor.start()
      expect(monitor.addAnnotation({ time: NOON, text: '   ' })).toBeNull()
      expect(monitor.addAnnotation({ time: 'not a time', text: 'Hi' })).toBeNull()
      expect(monitor.addAnnotation({ time: Number.NaN, text: 'Hi' })).toBeNull()
      expect(stored().annotations).toEqual([])
    })

    it('doesn’t count notes in the outages', () => {
      const { monitor } = noteSetup()
      monitor.start()
      monitor.addAnnotation({ time: NOON, text: 'Switched routers' })
      expect(monitor.getSnapshot().outages).toEqual([])
    })

    it('clears them with the rest of the history', () => {
      const { monitor } = noteSetup()
      monitor.start()
      monitor.addAnnotation({ time: NOON, text: 'Switched routers' })
      monitor.clearHistory()
      expect(stored().annotations).toEqual([])
      expect(monitor.getSnapshot().annotations).toEqual([])
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

      expect(tabA.monitor.getSnapshot()).toMatchObject({ role: 'leader', following: false })
      expect(tabB.monitor.getSnapshot()).toMatchObject({ role: 'follower', following: true })
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

    it('is not "following" until it hears from a leader', () => {
      const { tabB } = twoTabs()
      tabB.monitor.start() // waiting for the lock, which it will get: no other tab is open
      expect(tabB.monitor.getSnapshot()).toMatchObject({ role: 'follower', following: false })
    })

    it("a follower's edits to outages go through the leader", async () => {
      const ended: Outage = { id: 'old', startTime: iso(T0 - 2 * INTERVAL), endTime: iso(T0 - INTERVAL), duration: 60 }
      saveData({ ...emptyData(), trackingStartTime: iso(T0 - 10 * INTERVAL), outages: [ended] })
      const { tabA, tabB } = twoTabs({ a: [true] })
      tabA.monitor.start()
      tabB.monitor.start()
      await flush()

      tabB.monitor.setOutageFlagged('old', true)
      await flush()
      expect(stored().outages[0].flagged).toBe(true)
      expect(tabB.monitor.getSnapshot().outages[0].flagged).toBe(true)

      tabB.monitor.deleteOutage('old')
      await flush()
      expect(stored().outages).toEqual([])
      expect(tabA.monitor.getSnapshot().outages).toEqual([])
    })

    it("a follower's notes go through the leader", async () => {
      const { tabA, tabB } = twoTabs({ a: [true] })
      tabA.monitor.start()
      tabB.monitor.start()
      await flush()

      const id = tabB.monitor.addAnnotation({ time: T0, text: 'Switched routers' })
      await flush()
      expect(stored().annotations).toEqual([{ id, time: iso(T0), text: 'Switched routers' }])
      expect(tabA.monitor.getSnapshot().annotations).toHaveLength(1)
      expect(tabB.monitor.getSnapshot().annotations).toHaveLength(1)

      tabB.monitor.updateAnnotation(id!, { time: T0, text: 'New router' })
      await flush()
      expect(stored().annotations[0].text).toBe('New router')

      tabB.monitor.deleteAnnotation(id!)
      await flush()
      expect(stored().annotations).toEqual([])
      expect(tabB.monitor.getSnapshot().annotations).toEqual([])
    })

    describe('when the leader stops responding without closing', () => {
      // The leader's check never finishes, so it goes quiet but keeps the lock.
      function stuckLeader(browser = createBrowser(), b: boolean[] = [true, true]) {
        const stuck = deferredCheck()
        const tabA = setup(stuck.check, { coordinator: browser.tab() })
        const tabB = setup(b, { coordinator: browser.tab() })
        return { browser, stuck, tabA, tabB }
      }

      it('a follower takes over once it has heard nothing for too long', async () => {
        const { tabA, tabB } = stuckLeader()
        tabA.monitor.start()
        await flush()
        tabB.monitor.start()
        await flush()
        expect(tabB.monitor.getSnapshot()).toMatchObject({ following: true, leaderUnresponsive: false })

        await jest.advanceTimersByTimeAsync(gapThresholdMs(INTERVAL))
        expect(tabB.monitor.getSnapshot().role).toBe('follower') // silence this short is normal

        // Fake timers run a 0 ms timer set during a tick 1 ms later, hence the extra millisecond.
        await jest.advanceTimersByTimeAsync(INTERVAL + 1)
        expect(tabB.monitor.getSnapshot().role).toBe('leader')
        expect(tabB.check).toHaveBeenCalledTimes(1)
        // The old leader is told it lost the lock, and mirrors the new one.
        expect(tabA.monitor.getSnapshot()).toMatchObject({ role: 'follower', following: true })
      })

      it('does not take over just because this tab was asleep too', async () => {
        const { tabA, tabB } = stuckLeader()
        tabA.monitor.start()
        await flush()
        tabB.monitor.start()
        await flush()

        // The computer sleeps for an hour: no timers run, but the clock moves on.
        jest.setSystemTime(Date.now() + 60 * 60_000)
        await jest.advanceTimersByTimeAsync(INTERVAL)
        expect(tabB.monitor.getSnapshot().role).toBe('follower')

        // Still nothing from the leader once awake: then it takes over.
        await jest.advanceTimersByTimeAsync(gapThresholdMs(INTERVAL) + INTERVAL + 1)
        expect(tabB.monitor.getSnapshot().role).toBe('leader')
      })

      it('says the monitoring tab is not responding while taking over', async () => {
        const browser = createBrowser()
        const coordinator = browser.tab()
        const takeOver = jest.fn() // a takeover that doesn't go through, to see the state before it
        const stuck = deferredCheck()
        const tabA = setup(stuck.check, { coordinator: browser.tab() })
        const tabB = setup([], {
          coordinator: { ...coordinator, requestLeadership: callbacks => ({ ...coordinator.requestLeadership(callbacks), takeOver }) },
        })
        tabA.monitor.start()
        await flush()
        tabB.monitor.start()
        await flush()

        await jest.advanceTimersByTimeAsync(gapThresholdMs(INTERVAL) + INTERVAL)
        expect(takeOver).toHaveBeenCalled()
        expect(tabB.monitor.getSnapshot().leaderUnresponsive).toBe(true)

        // The leader comes back to life.
        stuck.resolve(true)
        await flush()
        expect(tabB.monitor.getSnapshot().leaderUnresponsive).toBe(false)
      })

      it('the old leader, when it wakes up, does not overwrite what the new leader saved', async () => {
        const browser = createBrowser()
        browser.suspendLostNotices() // it hasn't heard yet that it lost the lock
        const { stuck, tabA, tabB } = stuckLeader(browser)
        tabA.monitor.start()
        await flush()
        tabB.monitor.start()
        await flush()
        expect(readEpoch()).toBe(1)

        await jest.advanceTimersByTimeAsync(gapThresholdMs(INTERVAL) + INTERVAL + 1)
        expect(tabB.monitor.getSnapshot().role).toBe('leader')
        expect(readEpoch()).toBe(2)
        const saved = stored()
        expect(saved.lastCheckAt).toBe(Date.now())

        // The check it started before it was suspended finally fails.
        stuck.resolve(false)
        await flush()
        expect(stored()).toEqual(saved)
        expect(tabA.monitor.getSnapshot()).toMatchObject({ role: 'follower', following: true })

        browser.deliverLostNotices()
        await flush()
        expect(tabA.monitor.getSnapshot().role).toBe('follower')
      })
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
