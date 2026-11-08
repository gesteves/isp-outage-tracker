import {
  FAST_RETRY_MS,
  MonitorEvent,
  MonitorState,
  applyCheck,
  gapThresholdMs,
  initialMonitorState,
  isGap,
  newOutageId,
  nextCheckDelay,
  normalizeOutages,
  upsertOutage,
} from '@/lib/monitor'
import { Outage } from '@/types'

const INTERVAL = 60_000
const T0 = Date.parse('2024-01-01T12:00:00Z')
const at = (checks: number) => T0 + checks * INTERVAL
const iso = (ms: number) => new Date(ms).toISOString()

function makeOptions(threshold = 2) {
  let n = 0
  return { threshold, intervalMs: INTERVAL, newId: () => `outage-${++n}` }
}

type Check = boolean | { online: boolean; deviceOnline: boolean }

/** Feeds a sequence of results (one per interval) into the state machine. */
function run(results: Check[], { threshold = 2, from = initialMonitorState(null, null), isp = null as string | null } = {}) {
  const options = { ...makeOptions(threshold), isp }
  let state: MonitorState = from
  const events: MonitorEvent[] = []
  results.forEach((check, i) => {
    const { online, deviceOnline } = typeof check === 'boolean' ? { online: check, deviceOnline: true } : check
    const result = applyCheck(state, { online, at: at(i), deviceOnline }, options)
    state = result.state
    events.push(...result.events)
  })
  return { state, events }
}

describe('monitor state machine', () => {
  describe('initial status', () => {
    it('starts as unknown, not up', () => {
      expect(initialMonitorState(null, null).status).toBe('unknown')
    })

    it('starts as down when restoring an ongoing outage', () => {
      const outage: Outage = { id: 'o', startTime: iso(T0), endTime: null, duration: null }
      const state = initialMonitorState(outage, T0)
      expect(state.status).toBe('down')
      expect(state.currentOutage).toBe(outage)
    })

    it('becomes up after the first successful check', () => {
      expect(run([true]).state.status).toBe('up')
    })

    it('stays unknown while failures are below the threshold', () => {
      const { state, events } = run([false])
      expect(state.status).toBe('unknown')
      expect(state.streak.consecutiveFailures).toBe(1)
      expect(events).toEqual([])
    })

    it('stays up while failures are below the threshold', () => {
      expect(run([true, false]).state.status).toBe('up')
    })
  })

  describe('starting outages', () => {
    it('starts an outage once the threshold is reached', () => {
      const { state, events } = run([true, false, false])
      expect(state.status).toBe('down')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('started')
    })

    it('backdates the outage to the first failed check', () => {
      const { events } = run([true, false, false, false], { threshold: 3 })
      // Failures at checks 1, 2, 3; the outage started at check 1, not check 3.
      expect(events[0].outage.startTime).toBe(iso(at(1)))
    })

    it('respects a threshold of 1', () => {
      const { state, events } = run([true, false], { threshold: 1 })
      expect(state.status).toBe('down')
      expect(events[0].outage.startTime).toBe(iso(at(1)))
    })

    it('does not open a second outage while one is open', () => {
      const { events } = run([false, false, false, false, false])
      expect(events.filter(e => e.type === 'started')).toHaveLength(1)
    })

    it('resets the failure streak after a success', () => {
      const { state, events } = run([false, true, false])
      expect(events).toEqual([])
      expect(state.streak.consecutiveFailures).toBe(1)
      expect(state.streak.firstFailureAt).toBe(at(2))
    })
  })

  describe('ending outages', () => {
    it('ends the outage at the first successful check', () => {
      const { state, events } = run([true, false, false, true])
      expect(state.status).toBe('up')
      expect(state.currentOutage).toBeNull()
      const ended = events.find(e => e.type === 'ended')!
      expect(ended.outage.startTime).toBe(iso(at(1)))
      expect(ended.outage.endTime).toBe(iso(at(3)))
      expect(ended.outage.duration).toBe(120)
    })

    it('ends a restored outage normally after a quick reload', () => {
      const outage: Outage = { id: 'o', startTime: iso(T0), endTime: null, duration: null }
      // Last check one interval ago, so no gap.
      const from = initialMonitorState(outage, T0 + INTERVAL)
      const { events } = applyCheck(from, { online: true, at: T0 + 2 * INTERVAL }, makeOptions())
      expect(events).toEqual([
        { type: 'ended', outage: { ...outage, endTime: iso(T0 + 2 * INTERVAL), duration: 120 } },
      ])
    })
  })

  describe('gaps between checks (sleep, closed tab)', () => {
    const outage: Outage = { id: 'o', startTime: iso(T0), endTime: null, duration: null }
    const lastSeenDown = T0 + 5 * 60_000
    const nextMorning = T0 + 19 * 60 * 60_000

    it('tolerates normal timer throttling', () => {
      const from = initialMonitorState(outage, lastSeenDown)
      const { events } = applyCheck(
        from,
        { online: true, at: lastSeenDown + gapThresholdMs(INTERVAL) },
        makeOptions(),
      )
      expect(events[0].outage.endTime).toBe(iso(lastSeenDown + gapThresholdMs(INTERVAL)))
    })

    it('ends a restored outage at the last check that saw it down, not when the app reopened', () => {
      const from = initialMonitorState(outage, lastSeenDown)
      const { state, events } = applyCheck(from, { online: true, at: nextMorning }, makeOptions())
      expect(state.status).toBe('up')
      expect(events).toHaveLength(1)
      expect(events[0].outage.endTime).toBe(iso(lastSeenDown))
      expect(events[0].outage.duration).toBe(300)
      // Closed by the gap, not by seeing the connection come back.
      expect(events[0].gap).toBe(true)
    })

    it('does not mark ordinary recoveries as gap closures', () => {
      const { events } = run([true, false, false, true])
      expect(events.find(e => e.type === 'ended')?.gap).toBeUndefined()
    })

    it('closes the open outage even if the first check after waking fails', () => {
      const from = initialMonitorState(outage, lastSeenDown)
      const { state, events } = applyCheck(from, { online: false, at: nextMorning }, makeOptions())
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('ended')
      expect(events[0].outage.endTime).toBe(iso(lastSeenDown))
      // A single failure right after waking (e.g. Wi-Fi reconnecting) isn't an outage yet.
      expect(state.currentOutage).toBeNull()
      expect(state.status).toBe('unknown')
      expect(state.streak.consecutiveFailures).toBe(1)
    })

    it('does not backdate a new outage across a gap', () => {
      const options = makeOptions()
      let { state } = applyCheck(initialMonitorState(null, null), { online: false, at: T0 }, options)
      ;({ state } = applyCheck(state, { online: false, at: nextMorning }, options))
      expect(state.currentOutage).toBeNull()
      expect(state.streak.firstFailureAt).toBe(nextMorning)

      const result = applyCheck(state, { online: false, at: nextMorning + INTERVAL }, options)
      expect(result.events[0].outage.startTime).toBe(iso(nextMorning))
    })

    it('can close the old outage and open a new one in the same check', () => {
      const from = initialMonitorState(outage, lastSeenDown)
      const { state, events } = applyCheck(from, { online: false, at: nextMorning }, makeOptions(1))
      expect(events.map(e => e.type)).toEqual(['ended', 'started'])
      expect(state.currentOutage?.startTime).toBe(iso(nextMorning))
    })
  })

  describe('normalizeOutages', () => {
    it('keeps only the most recent open outage', () => {
      const outages: Outage[] = [
        { id: 'phantom', startTime: iso(T0), endTime: null, duration: null },
        { id: 'twin', startTime: iso(T0), endTime: iso(T0 + 60_000), duration: 60 },
        { id: 'current', startTime: iso(T0 + 120_000), endTime: null, duration: null },
      ]
      expect(normalizeOutages(outages).map(o => o.id)).toEqual(['twin', 'current'])
    })

    it('drops an open outage older than a completed one', () => {
      const outages: Outage[] = [
        { id: 'phantom', startTime: iso(T0), endTime: null, duration: null },
        { id: 'later', startTime: iso(T0 + 60_000), endTime: iso(T0 + 120_000), duration: 60 },
      ]
      expect(normalizeOutages(outages).map(o => o.id)).toEqual(['later'])
    })

    it('leaves valid data untouched', () => {
      const outages: Outage[] = [
        { id: 'a', startTime: iso(T0), endTime: iso(T0 + 60_000), duration: 60 },
        { id: 'b', startTime: iso(T0 + 120_000), endTime: null, duration: null },
      ]
      expect(normalizeOutages(outages)).toEqual(outages)
    })
  })

  describe('newOutageId', () => {
    it('generates unique ids', () => {
      expect(newOutageId()).not.toBe(newOutageId())
    })
  })

  describe('local network outages', () => {
    const local = { online: false, deviceOnline: false }
    const ispDown = { online: false, deviceOnline: true }

    it('tags an outage local when the device had no network for every failure', () => {
      const { events } = run([true, local, local])
      expect(events[0].outage.cause).toBe('local')
    })

    it('tags an outage isp when the device was online', () => {
      const { events } = run([true, ispDown, ispDown])
      expect(events[0].outage.cause).toBe('isp')
    })

    it('tags it isp if any failure in the streak had the device online', () => {
      expect(run([true, ispDown, local]).events[0].outage.cause).toBe('isp')
      expect(run([true, local, ispDown]).events[0].outage.cause).toBe('isp')
    })

    it('flips a local outage to isp mid-outage and emits an update', () => {
      // Wi-Fi drops, then comes back, but the internet doesn't (e.g. a router reboot).
      const { state, events } = run([true, local, local, ispDown, ispDown])
      expect(events.map(e => e.type)).toEqual(['started', 'updated'])
      expect(events[1].outage.id).toBe(events[0].outage.id)
      expect(events[1].outage.cause).toBe('isp')
      expect(state.currentOutage?.cause).toBe('isp')
    })

    it('never flips an isp outage back to local', () => {
      const { state, events } = run([true, ispDown, ispDown, local])
      expect(events.map(e => e.type)).toEqual(['started'])
      expect(state.currentOutage?.cause).toBe('isp')
    })

    it('starts a fresh streak after a success', () => {
      expect(run([ispDown, true, local, local]).events[0].outage.cause).toBe('local')
    })
  })

  describe('ISP on outages', () => {
    it('records the ISP known when the outage starts', () => {
      const { events } = run([true, false, false], { isp: 'Comcast' })
      expect(events[0].outage.isp).toBe('Comcast')
    })

    it('records null when the ISP is unknown', () => {
      expect(run([true, false, false]).events[0].outage.isp).toBeNull()
    })
  })

  describe('nextCheckDelay', () => {
    it('waits the full interval while the connection is up', () => {
      expect(nextCheckDelay(run([true]).state, INTERVAL)).toBe(INTERVAL)
    })

    it('re-checks quickly after a failure, to confirm the outage sooner', () => {
      expect(nextCheckDelay(run([true, false]).state, INTERVAL)).toBe(FAST_RETRY_MS)
    })

    it('keeps re-checking quickly during an outage, to catch the recovery sooner', () => {
      expect(nextCheckDelay(run([false, false, false]).state, INTERVAL)).toBe(FAST_RETRY_MS)
    })

    it('never waits longer than the configured interval', () => {
      expect(nextCheckDelay(run([false]).state, 5000)).toBe(5000)
    })
  })

  describe('isGap', () => {
    it('is false without a previous check', () => {
      expect(isGap(null, T0, INTERVAL)).toBe(false)
    })

    it('is true only past the gap threshold', () => {
      expect(isGap(T0, T0 + gapThresholdMs(INTERVAL), INTERVAL)).toBe(false)
      expect(isGap(T0, T0 + gapThresholdMs(INTERVAL) + 1, INTERVAL)).toBe(true)
    })
  })

  describe('upsertOutage', () => {
    const a: Outage = { id: 'a', startTime: iso(T0), endTime: null, duration: null }

    it('appends new outages', () => {
      expect(upsertOutage([], a)).toEqual([a])
    })

    it('replaces an outage with the same id without mutating the list', () => {
      const list = [a]
      const ended = { ...a, endTime: iso(T0 + 1000), duration: 1 }
      expect(upsertOutage(list, ended)).toEqual([ended])
      expect(list).toEqual([a])
    })
  })
})
