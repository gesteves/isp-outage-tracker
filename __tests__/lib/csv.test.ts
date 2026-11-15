import { CSV_HEADERS, buildCsv, exportToCSV } from '@/lib/csv'
import { formatLocalIso } from '@/lib/format'
import { Outage } from '@/types'

const rows = (csv: string) => csv.split('\n').map(line => line.slice(1, -1).split('","'))

/** Each data row as { header: cell }. */
function records(csv: string): Array<Record<string, string>> {
  const [header, ...data] = rows(csv)
  return data.map(row => Object.fromEntries(header.map((name, i) => [name, row[i]])))
}

const TZ = 'America/Denver'
const recordsOf = (outages: Outage[]) => records(buildCsv(outages, TZ))

describe('buildCsv', () => {
  const completed: Outage = {
    id: 'a',
    startTime: '2024-01-01T10:00:00.000Z',
    endTime: '2024-01-01T11:00:30.000Z',
    duration: 3630,
    cause: 'isp',
    isp: 'Comcast',
  }

  const diagnosed: Outage = {
    ...completed,
    endReason: 'restored',
    checkIntervalSeconds: 60,
    failureThreshold: 2,
    failure: 'dns',
    ip: '203.0.113.7',
    asn: 'AS7922',
    ispAfter: 'Backup LTE',
    ipAfter: '198.51.100.2',
    asnAfter: 'AS21928',
    latencyBeforeMs: 42,
    latencyAfterMs: 87,
  }

  it('starts with the headers', () => {
    expect(rows(buildCsv([]))[0]).toEqual(CSV_HEADERS)
  })

  it('quotes headers that contain commas, so the header has as many columns as the rows', () => {
    const [header] = buildCsv([completed]).split('\n')
    expect(header).toContain('"Start (UTC, ISO 8601)"')
    expect(header).toContain('"End (UTC, ISO 8601)"')
    for (const row of rows(buildCsv([completed, diagnosed]))) expect(row).toHaveLength(CSV_HEADERS.length)
  })

  it('writes local times with their UTC offset, next to UTC, the time zone and the weekday', () => {
    const [row] = recordsOf([completed])
    expect(row['Start (local)']).toBe(formatLocalIso(completed.startTime))
    expect(row['End (local)']).toBe(formatLocalIso(completed.endTime!))
    expect(row['Start (UTC, ISO 8601)']).toBe('2024-01-01T10:00:00.000Z')
    expect(row['End (UTC, ISO 8601)']).toBe('2024-01-01T11:00:30.000Z')
    expect(row['Time zone']).toBe(TZ)
    expect(row['Day of week']).toBe(new Date(completed.startTime).toLocaleDateString('en-US', { weekday: 'long' }))
  })

  it('uses the browser time zone by default', () => {
    const [row] = records(buildCsv([completed]))
    expect(row['Time zone']).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('includes durations in seconds and minutes, cause and ISP', () => {
    const [row] = recordsOf([completed])
    expect(row['Duration (seconds)']).toBe('3630')
    expect(row['Duration (minutes)']).toBe('60.50')
    expect(row.Cause).toBe('ISP')
    expect(row.ISP).toBe('Comcast')
    expect(row.Flagged).toBe('')
  })

  it('computes minutes from the rounded seconds, so the two agree', () => {
    const [row] = recordsOf([{ ...completed, duration: 240.41 }])
    expect(row['Duration (seconds)']).toBe('240')
    expect(row['Duration (minutes)']).toBe('4.00')
  })

  it('counts the seconds since the previous outage ended', () => {
    const next = { ...completed, id: 'b', startTime: '2024-01-01T11:01:30.000Z', endTime: null, duration: null }
    const [first, second] = recordsOf([next, completed])
    expect(first['Since previous outage (seconds)']).toBe('')
    expect(second['Since previous outage (seconds)']).toBe('60')
  })

  it('exports the diagnostics', () => {
    const [row] = recordsOf([diagnosed])
    expect(row).toMatchObject({
      'Failure type': 'DNS only',
      'Ended by': 'Connection restored',
      ISP: 'Comcast',
      'ISP after': 'Backup LTE',
      'Public IP before': '203.0.113.7',
      'Public IP after': '198.51.100.2',
      'ASN before': 'AS7922',
      'ASN after': 'AS21928',
      'Response time before (ms)': '42',
      'Response time after (ms)': '87',
      'Check interval (seconds)': '60',
      'Failure threshold': '2',
    })
  })

  it('labels every failure type and end reason', () => {
    const [all, mixed, gap] = recordsOf([
      { ...diagnosed, id: '1', failure: 'all' },
      { ...diagnosed, id: '2', startTime: '2024-01-02T10:00:00.000Z', failure: 'mixed' },
      { ...diagnosed, id: '3', startTime: '2024-01-03T10:00:00.000Z', endReason: 'gap' },
    ])
    expect(all['Failure type']).toBe('All targets')
    expect(mixed['Failure type']).toBe('Mixed')
    expect(gap['Ended by']).toBe('Monitoring stopped')
  })

  it('leaves fields that older records did not track blank', () => {
    const [row] = recordsOf([completed])
    for (const header of [
      'Failure type',
      'Ended by',
      'ISP after',
      'Public IP before',
      'Public IP after',
      'ASN before',
      'ASN after',
      'Response time before (ms)',
      'Response time after (ms)',
      'Check interval (seconds)',
      'Failure threshold',
    ]) {
      expect(row[header]).toBe('')
    }
  })

  it('leaves end and duration blank for ongoing outages', () => {
    const [row] = recordsOf([{ id: 'b', startTime: '2024-01-01T10:00:00.000Z', endTime: null, duration: null, cause: 'local' }])
    expect(row['End (local)']).toBe('Ongoing')
    expect(row['End (UTC, ISO 8601)']).toBe('')
    expect(row['Duration (seconds)']).toBe('')
    expect(row['Duration (minutes)']).toBe('')
    expect(row.Cause).toBe('Local network')
  })

  it('exports a zero-second outage as 0, not blank', () => {
    const [row] = recordsOf([{ ...completed, endTime: completed.startTime, duration: 0 }])
    expect(row['Duration (seconds)']).toBe('0')
    expect(row['Duration (minutes)']).toBe('0.00')
  })

  it('treats records without a cause as ISP outages', () => {
    const [row] = recordsOf([{ id: 'c', startTime: '2024-01-01T10:00:00.000Z', endTime: null, duration: null }])
    expect(row.Cause).toBe('ISP')
  })

  it('sorts oldest first', () => {
    const later = { ...completed, id: 'z', startTime: '2024-02-01T10:00:00.000Z' }
    const [first, second] = recordsOf([later, completed])
    expect(first['Start (UTC, ISO 8601)']).toBe(completed.startTime)
    expect(second['Start (UTC, ISO 8601)']).toBe(later.startTime)
  })

  it('escapes quotes', () => {
    expect(buildCsv([{ ...completed, isp: 'Say "hi" ISP' }])).toContain('"Say ""hi"" ISP"')
  })

  it('keeps ISP names from being read as spreadsheet formulas', () => {
    const [row] = recordsOf([{ ...completed, isp: '=HYPERLINK("x")', ispAfter: '+SUM(1)' }])
    expect(row.ISP).toBe(`'=HYPERLINK(""x"")`)
    expect(row['ISP after']).toBe(`'+SUM(1)`)
    expect(recordsOf([completed])[0].ISP).toBe('Comcast')
  })

  it('marks outages flagged as not real', () => {
    const [row] = recordsOf([{ ...completed, flagged: true }])
    expect(row.Flagged).toBe('Not an outage')
  })
})

describe('exportToCSV', () => {
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

  it('downloads a dated file and cleans up', () => {
    let link: HTMLAnchorElement | undefined
    const realCreateElement = document.createElement.bind(document)
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreateElement(tag)
      if (tag === 'a') link = el as HTMLAnchorElement
      return el
    })

    exportToCSV([])

    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
    expect(link?.getAttribute('download')).toMatch(/^isp-outages-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(document.body.contains(link!)).toBe(false)
  })

  it('names the file after the local date, not the UTC one', () => {
    let link: HTMLAnchorElement | undefined
    const realCreateElement = document.createElement.bind(document)
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreateElement(tag)
      if (tag === 'a') link = el as HTMLAnchorElement
      return el
    })
    // Late evening, local time: in the Americas it's already tomorrow in UTC.
    exportToCSV([], new Date(2024, 0, 1, 23, 30).getTime())
    expect(link?.getAttribute('download')).toBe('isp-outages-2024-01-01.csv')
  })

  it('starts the file with a UTF-8 byte order mark, for Excel', async () => {
    jest.useRealTimers()
    let blob: Blob | undefined
    global.URL.createObjectURL = jest.fn((b: Blob) => {
      blob = b
      return 'blob:mock-url'
    })
    exportToCSV([])
    const bytes = await new Promise<Uint8Array>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
      reader.readAsArrayBuffer(blob!)
    })
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
  })

  it('revokes the object URL after the download starts', () => {
    exportToCSV([])
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    jest.runAllTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
