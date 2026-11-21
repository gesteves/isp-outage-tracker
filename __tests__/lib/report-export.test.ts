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
