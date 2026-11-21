import { buildCsv } from '@/lib/csv'
import { formatLocalIso, formatPercentage } from '@/lib/format'
import { MAX_COVERAGE_DAYS, ReportInput, buildReportMarkdown, exportReport } from '@/lib/report-export'
import { calculateStats } from '@/lib/stats'
import { Outage } from '@/types'

const TZ = 'America/Denver'
const HOUR = 3600 * 1000
const INTERVAL = 60_000
// Local times, so the day boundaries hold in whatever time zone the tests run in.
const at = (day: number, hour: number, minute = 0) => new Date(2025, 9, day, hour, minute).getTime()
const NOW = at(20, 12)

function outage(id: string, start: number, minutes: number, extra: Partial<Outage> = {}): Outage {
  return {
    id,
    startTime: new Date(start).toISOString(),
    endTime: new Date(start + minutes * 60_000).toISOString(),
    duration: minutes * 60,
    cause: 'isp',
    endReason: 'restored',
    ...extra,
  }
}

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    outages: [
      outage('isp', at(18, 10), 10),
      outage('local', at(20, 8), 5, { cause: 'local' }),
      outage('flagged', at(20, 9), 30, { flagged: true }),
    ],
    annotations: [{ id: 'n1', time: new Date(at(18, 9)).toISOString(), text: 'New router ```not code```' }],
    trackingStartTime: new Date(at(18, 0)).toISOString(),
    lastCheckAt: NOW,
    // The 19th is missing: the app wasn't running.
    monitoredByDay: { '2025-10-18': 24 * HOUR, '2025-10-20': 12 * HOUR },
    legacyMonitoredMs: 0,
    ...overrides,
  }
}

const build = (data: ReportInput = input()) =>
  buildReportMarkdown(data, { now: NOW, intervalMs: INTERVAL, failureThreshold: 2, timeZone: TZ, ispName: 'Example ISP' })

describe('buildReportMarkdown', () => {
  it('starts with when and how the data was collected', () => {
    const md = build()
    expect(md.startsWith('# ISP outage data export\n')).toBe(true)
    expect(md).toContain(`- Exported: ${formatLocalIso(NOW)} (${TZ})`)
    expect(md).toContain(`- Tracking since: ${formatLocalIso(at(18, 0))}`)
    expect(md).toContain('- Check interval: 60 seconds; failure threshold: 2 failed checks in a row')
    expect(md).toContain('- Current ISP: Example ISP')
    expect(md).toContain('## How to read this data')
    expect(md).toContain('its duration is a lower bound')
  })

  it("lists every day since tracking started, including days the app wasn't running", () => {
    const md = build()
    expect(md).toContain('| 2025-10-18 | Saturday | 24.0 | 10.0 | 0.0 | 1 |')
    expect(md).toContain('| 2025-10-19 | Sunday | 0.0 | 0.0 | 0.0 | 0 |')
    // The flagged outage is left out; the local one isn't ISP downtime.
    expect(md).toContain('| 2025-10-20 | Monday | 12.0 | 0.0 | 5.0 | 1 |')
    expect(md).not.toContain('| 2025-10-17 |')
    expect(md).not.toContain('| 2025-10-21 |')
  })

  it("uses the app's own figures in the summary", () => {
    const data = input()
    const stats = calculateStats(data, NOW, INTERVAL)
    const md = build(data)
    expect(md).toContain(`| All time | 36.0 | 2 | 10.0 | 5.0 | ${formatPercentage(stats.uptimePercentage)}% |`)
    expect(md).toContain('| Today | 12.0 | 1 | 0.0 | 5.0 | 100.00% |')
    expect(md).toContain('1 ISP outage and 1 local network outage')
    expect(md).toContain('Monitored 36.0 of the 60.0 hours since tracking started (60.0%).')
  })

  it('says a window had no monitoring instead of reporting 100% uptime', () => {
    const md = build(input({ monitoredByDay: { '2025-10-18': 24 * HOUR }, lastCheckAt: at(19, 0) }))
    expect(md).toContain('| Today | 0.0 | 1 | 0.0 | 5.0 | n/a (not monitored) |')
  })

  it('includes the same rows as the CSV export, in a fence notes cannot close', () => {
    const data = input()
    const md = build(data)
    const csv = buildCsv(data.outages, data.annotations, TZ)
    expect(md).toContain(`\n\`\`\`\`csv\n${csv}\n\`\`\`\`\n`)
    expect(md.endsWith('````\n')).toBe(true)
  })

  it('uses a plain fence when no note has backticks', () => {
    const md = build(input({ annotations: [] }))
    expect(md).toMatch(/\n```csv\n[\s\S]*\n```\n$/)
  })

  it('explains monitoring time that has no per-day record', () => {
    expect(build(input({ legacyMonitoredMs: 48 * HOUR }))).toContain(
      "48.0 monitored hours from before the app recorded monitoring per day count toward the all-time figures but aren't in this table.",
    )
    expect(build()).not.toContain('from before the app recorded')
  })

  it('caps the daily table on long histories', () => {
    const start = new Date(2025, 9, 20 - 400, 0).toISOString()
    const md = build(input({ trackingStartTime: start }))
    const rows = md.split('\n').filter(line => /^\| \d{4}-\d{2}-\d{2} \|/.test(line))
    expect(rows).toHaveLength(MAX_COVERAGE_DAYS)
    expect(rows[rows.length - 1]).toMatch(/^\| 2025-10-20 \|/)
    expect(md).toContain(`Only the last ${MAX_COVERAGE_DAYS} of 401 days are listed.`)
  })

  it('still exports notes before tracking has started', () => {
    const md = build(input({ outages: [], trackingStartTime: null, monitoredByDay: {}, lastCheckAt: null }))
    expect(md).toContain('- Tracking since: not started')
    expect(md).not.toContain('## Summary')
    expect(md).not.toContain('## Daily coverage')
    expect(md).toContain('"Note"')
  })
})

describe('new sections', () => {
  it('lists incidents, the duration distribution and the summary facts', () => {
    const md = build(input({
      outages: [
        outage('a', at(18, 10), 2),
        outage('b', at(18, 10, 5), 20), // 3 minutes after a: same incident
        outage('c', at(20, 9), 300),
        outage('local', at(20, 8), 5, { cause: 'local' }),
      ],
    }))
    expect(md).toContain('## Incidents')
    expect(md).toContain(`| 1 | ${formatLocalIso(at(18, 10))} | ${formatLocalIso(at(18, 10, 25))} | 25.0 | 2 | 22.0 |`)
    expect(md).toContain('## Outage durations')
    expect(md).toContain('| 1–5 minutes | 1 | 2.0 | 0.6% |')
    expect(md).toContain('| 15–60 minutes | 1 | 20.0 | 6.2% |')
    expect(md).toContain('| 4 hours or more | 1 | 300.0 | 93.2% |')
    expect(md).toContain('- ISP outages: 3 in 2 incidents. Duration: median 20.0 minutes')
  })

  it("leaves out summary windows that would repeat all time, and says so", () => {
    const md = build()
    expect(md).not.toContain('| Last 7 days |')
    expect(md).not.toContain('| Last 30 days |')
    expect(md).toContain('| Today |')
    expect(md).toContain('so last 30 days and last 7 days would be the same as all time')
  })

  it('breaks downtime down by hour of the day, against the time monitored then', () => {
    const md = build(input({
      outages: [outage('a', at(20, 9, 30), 60)],
      // The last check was 3 minutes ago: the time since counts as monitored.
      monitoredByHour: { '2025-10-20T09': HOUR, '2025-10-20T10': HOUR, '2025-10-20T11': 57 * 60_000 },
      lastCheckAt: at(20, 11, 57),
    }))
    expect(md).toContain(`since ${formatLocalIso(at(20, 9))}`)
    expect(md).toContain('| 09:00–09:59 | 1.0 | 1 | 30.0 | 50.0% |')
    expect(md).toContain('| 10:00–10:59 | 1.0 | 0 | 30.0 | 50.0% |')
    expect(md).toContain('| 11:00–11:59 | 1.0 | 0 | 0.0 | 0.0% |') // the live tail up to now
    expect(md).toContain('| 03:00–03:59 | 0.0 | 0 | 0.0 | n/a |')
  })

  it('says when there is no per-hour data yet', () => {
    expect(build()).toContain("Not available yet: the app hasn't recorded monitored time per hour.")
  })

  it('compares the periods before and after each note', () => {
    const md = build()
    expect(md).toContain('## Before and after notes')
    // The 18th: 24 monitored hours spread over the day, so 9 of them before the 9:00 note.
    expect(md).toContain(`| Before the first note | ${formatLocalIso(at(18, 0))} | ${formatLocalIso(at(18, 9))} | 9.0 | 0 | 0 | 0.0 | 0.0 | 100.00% |`)
    expect(md).toContain('| After "New router ```not code```" |')
  })

  it('has no notes section without notes inside the tracked period', () => {
    expect(build(input({ annotations: [] }))).not.toContain('## Before and after notes')
  })
})

describe('with the data from a real week of outages', () => {
  // Start (local) and duration (seconds) of each outage, in November 2026.
  const RAW = `16 06:51:27 180|16 06:58:33 60|16 07:01:33 210|16 07:08:09 45|16 08:27:29 120|16 08:34:31 4336|16 09:50:48 30|16 09:52:18 570|16 10:02:53 270|16 10:12:26 255|18 10:10:17 405|18 10:26:13 1185|18 23:46:15 150|19 00:18:10 150|19 01:32:24 45|19 01:35:10 210|19 11:12:04 330|19 11:22:36 1605|19 11:57:28 61168|20 05:01:04 105|20 05:03:54 30|20 05:05:26 1530|20 10:15:40 1441|20 10:50:03 90|21 00:02:00 30|21 01:54:21 1050|21 02:41:30 90|21 03:40:58 27966|21 11:28:06 60|21 11:32:16 105`
  const local = (day: number, h: number, m = 0, s = 0) => new Date(2026, 10, day, h, m, s).getTime()
  const outages: Outage[] = RAW.split('|').map((entry, i) => {
    const [day, time, seconds] = entry.split(' ')
    const [h, m, s] = time.split(':').map(Number)
    const start = local(Number(day), h, m, s)
    return {
      id: `o${i}`,
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + Number(seconds) * 1000).toISOString(),
      duration: Number(seconds),
      cause: 'isp',
      endReason: 'restored',
    }
  })
  const now = local(21, 14, 51, 25)
  const hoursMs = (h: number) => h * HOUR
  const md = buildReportMarkdown(
    {
      outages,
      annotations: [{ id: 'n', time: new Date(local(20, 12)).toISOString(), text: 'Switched to Silver Star router' }],
      trackingStartTime: new Date(local(16, 6, 40, 22)).toISOString(),
      lastCheckAt: now,
      monitoredByDay: {
        '2026-11-16': hoursMs(17.3),
        '2026-11-17': hoursMs(24),
        '2026-11-18': hoursMs(24),
        '2026-11-19': hoursMs(24),
        '2026-11-20': hoursMs(23.1),
        '2026-11-21': hoursMs(14.9),
      },
      legacyMonitoredMs: 0,
    },
    { now, intervalMs: INTERVAL, failureThreshold: 2, timeZone: TZ },
  )

  it('groups the 30 outages into 13 incidents', () => {
    expect(md).toContain('- ISP outages: 30 in 13 incidents.')
    const incidentRows = md.split('## Incidents')[1].split('##')[0].split('\n').filter(line => /^\| \d+ \|/.test(line))
    expect(incidentRows).toHaveLength(13)
    expect(incidentRows[1]).toContain('| 109.2 | 6 | 93.0 |')
  })

  it('shows the router switch made no difference', () => {
    expect(md).toMatch(/\| Before the first note \| [^|]+ \| [^|]+ \| 100\.8 \| 24 \| 9 \| 1242\.\d \| 5\.7 \| 79\.\d\d% \|/)
    expect(md).toMatch(/\| After "Switched to Silver Star router" \| [^|]+ \| [^|]+ \| 26\.4 \| 6 \| 4 \| 488\.\d \| 5\.4 \| 69\.\d\d% \|/)
  })

  it('shows most outages are short but two long ones are most of the downtime', () => {
    expect(md).toContain('| 1–5 minutes | 14 |')
    expect(md).toMatch(/\| 4 hours or more \| 2 \| 1485\.6 \| 85\.9% \|/)
  })
})

describe('exportReport', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url')
    global.URL.revokeObjectURL = jest.fn()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('downloads a dated Markdown file', async () => {
    let link: HTMLAnchorElement | undefined
    let blob: Blob | undefined
    const realCreateElement = document.createElement.bind(document)
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreateElement(tag)
      if (tag === 'a') link = el as HTMLAnchorElement
      return el
    })
    ;(URL.createObjectURL as jest.Mock).mockImplementation((b: Blob) => {
      blob = b
      return 'blob:mock-url'
    })

    // Late evening, local time: in the Americas it's already tomorrow in UTC.
    exportReport(input(), { now: at(20, 23, 30), intervalMs: INTERVAL, failureThreshold: 2, timeZone: TZ })

    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
    expect(link?.getAttribute('download')).toBe('isp-outage-report-data-2025-10-20.md')
    expect(blob?.type).toBe('text/markdown;charset=utf-8')
    jest.runAllTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
