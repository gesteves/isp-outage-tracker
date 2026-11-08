import {
  StatsInput,
  accrueMonitoredTime,
  calculateStats,
  dailyBreakdown,
  dayKey,
  startOfNextDay,
} from '@/lib/stats'
import { Outage } from '@/types'

// Local-time dates, so day boundaries are right in any timezone. (Mid-January: no DST change.)
const local = (day: number, hour = 0, minute = 0) => new Date(2024, 0, day, hour, minute).getTime()
const iso = (ms: number) => new Date(ms).toISOString()
const H = 3600 * 1000
const INTERVAL = 60_000

function input(overrides: Partial<StatsInput> = {}): StatsInput {
  return {
    outages: [],
    trackingStartTime: iso(local(10)),
    lastCheckAt: null,
    monitoredByDay: {},
    legacyMonitoredMs: 0,
    ...overrides,
  }
}

function outage(startMs: number, endMs: number | null, cause?: Outage['cause']): Outage {
  return {
    id: `o-${startMs}`,
    startTime: iso(startMs),
    endTime: endMs === null ? null : iso(endMs),
    duration: endMs === null ? null : (endMs - startMs) / 1000,
    cause,
  }
}

describe('day helpers', () => {
  it('dayKey uses the local date', () => {
    expect(dayKey(local(5, 23, 59))).toBe('2024-01-05')
    expect(dayKey(local(6, 0, 0))).toBe('2024-01-06')
  })

  it('startOfNextDay returns the next local midnight', () => {
    expect(startOfNextDay(local(5, 13))).toBe(local(6))
    expect(startOfNextDay(local(6))).toBe(local(7))
  })
})

describe('accrueMonitoredTime', () => {
  it('adds a span within one day', () => {
    expect(accrueMonitoredTime({}, local(5, 10), local(5, 11))).toEqual({ '2024-01-05': H })
  })

  it('splits a span across midnight', () => {
    expect(accrueMonitoredTime({ '2024-01-05': 1000 }, local(5, 23, 30), local(6, 0, 15))).toEqual({
      '2024-01-05': 1000 + 30 * 60_000,
      '2024-01-06': 15 * 60_000,
    })
  })

  it('does not mutate its input', () => {
    const byDay = { '2024-01-05': 1 }
    accrueMonitoredTime(byDay, local(5, 1), local(5, 2))
    expect(byDay).toEqual({ '2024-01-05': 1 })
  })
})

describe('calculateStats', () => {
  it('returns defaults without a tracking start time', () => {
    const stats = calculateStats(input({ trackingStartTime: null }), local(11), INTERVAL)
    expect(stats.uptimePercentage).toBe(100)
    expect(stats.trackingStartTime).toBeNull()
  })

  it('computes uptime over monitored time only, not wall-clock time', () => {
    // Tracked for 10 days, but only monitored for 10 hours, with 1 hour of ISP downtime.
    const stats = calculateStats(
      input({
        monitoredByDay: { '2024-01-15': 10 * H },
        outages: [outage(local(15, 9), local(15, 10))],
      }),
      local(20),
      INTERVAL,
    )
    expect(stats.trackedSeconds).toBe(10 * 24 * 3600)
    expect(stats.monitoredSeconds).toBe(10 * 3600)
    expect(stats.uptimePercentage).toBeCloseTo(90)
  })

  it('includes legacy monitoring time from migrated data', () => {
    const stats = calculateStats(input({ legacyMonitoredMs: 4 * H, monitoredByDay: { '2024-01-15': 6 * H } }), local(20), INTERVAL)
    expect(stats.monitoredSeconds).toBe(10 * 3600)
  })

  it('leaves local outages out of ISP uptime entirely', () => {
    const stats = calculateStats(
      input({
        monitoredByDay: { '2024-01-15': 12 * H },
        outages: [
          outage(local(15, 1), local(15, 3), 'local'), // 2h with no network: not observable
          outage(local(15, 5), local(15, 6), 'isp'), // 1h ISP downtime
        ],
      }),
      local(20),
      INTERVAL,
    )
    expect(stats.localOutages).toBe(1)
    expect(stats.localDowntime).toBe(2 * 3600)
    expect(stats.ispOutages).toBe(1)
    expect(stats.ispDowntime).toBe(3600)
    // 1h down out of the 10 observable hours.
    expect(stats.uptimePercentage).toBeCloseTo(90)
  })

  it('treats outages without a cause as ISP outages', () => {
    const stats = calculateStats(
      input({ monitoredByDay: { '2024-01-15': 10 * H }, outages: [outage(local(15, 1), local(15, 2))] }),
      local(20),
      INTERVAL,
    )
    expect(stats.ispOutages).toBe(1)
  })

  it('counts the time since the last check, live', () => {
    const lastCheckAt = local(15, 12)
    const stats = calculateStats(
      input({ lastCheckAt, monitoredByDay: { '2024-01-15': H } }),
      lastCheckAt + 30_000,
      INTERVAL,
    )
    expect(stats.monitoredSeconds).toBe(3600 + 30)
  })

  it('stops growing ongoing numbers when checks stop', () => {
    const lastCheckAt = local(15, 12)
    const ongoing = outage(lastCheckAt - H, null)
    const stats = calculateStats(
      input({ lastCheckAt, monitoredByDay: { '2024-01-15': 2 * H }, outages: [ongoing] }),
      lastCheckAt + 24 * H, // a day later, no checks since
      INTERVAL,
    )
    const cap = 2 * INTERVAL + 60_000
    expect(stats.monitoredSeconds).toBe((2 * H + cap) / 1000)
    expect(stats.ispDowntime).toBe((H + cap) / 1000)
  })

  it('never reports uptime outside 0-100', () => {
    const stats = calculateStats(
      input({ monitoredByDay: { '2024-01-15': H }, outages: [outage(local(15, 0), local(15, 5))] }),
      local(20),
      INTERVAL,
    )
    expect(stats.uptimePercentage).toBe(0)
  })
})

describe('dailyBreakdown', () => {
  const now = local(20, 12)

  it('returns one entry per day, oldest first, ending today', () => {
    const days = dailyBreakdown(input(), now, INTERVAL, 30)
    expect(days).toHaveLength(30)
    expect(days[29].day).toBe('2024-01-20')
    expect(days[0].day).toBe('2023-12-22')
    expect(days[29].start).toBe(local(20))
  })

  it('splits downtime across midnight by cause and counts outages on their start day', () => {
    const days = dailyBreakdown(
      input({
        outages: [
          outage(local(18, 23), local(19, 1), 'isp'),
          outage(local(19, 10), local(19, 10, 30), 'local'),
        ],
      }),
      now,
      INTERVAL,
      7,
    )
    const byDay = Object.fromEntries(days.map(d => [d.day, d]))
    expect(byDay['2024-01-18']).toMatchObject({ ispSeconds: 3600, localSeconds: 0, outages: 1 })
    expect(byDay['2024-01-19']).toMatchObject({ ispSeconds: 3600, localSeconds: 1800, outages: 1 })
  })

  it('reports monitored time per day, plus the live tail today', () => {
    const lastCheckAt = now - 20_000
    const days = dailyBreakdown(
      input({ lastCheckAt, monitoredByDay: { '2024-01-19': 5 * H, '2024-01-20': H } }),
      now,
      INTERVAL,
      3,
    )
    expect(days.map(d => d.monitoredSeconds)).toEqual([0, 5 * 3600, 3600 + 20])
  })

  it('extends an ongoing outage only up to the live edge', () => {
    const lastCheckAt = now - 10_000
    const days = dailyBreakdown(
      input({ lastCheckAt, outages: [outage(now - H, null)] }),
      now,
      INTERVAL,
      1,
    )
    expect(days[0].ispSeconds).toBe(3600)
  })

  it('ignores outages outside the window', () => {
    const days = dailyBreakdown(input({ outages: [outage(local(1, 1), local(1, 2))] }), now, INTERVAL, 7)
    expect(days.every(d => d.ispSeconds === 0 && d.outages === 0)).toBe(true)
  })
})
