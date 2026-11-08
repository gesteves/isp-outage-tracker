import { CSV_HEADERS, buildCsv, exportToCSV } from '@/lib/csv'
import { Outage } from '@/types'

const rows = (csv: string) => csv.split('\n').map(line => line.slice(1, -1).split('","'))

describe('buildCsv', () => {
  const completed: Outage = {
    id: 'a',
    startTime: '2024-01-01T10:00:00.000Z',
    endTime: '2024-01-01T11:00:30.000Z',
    duration: 3630,
    cause: 'isp',
    isp: 'Comcast',
  }

  it('starts with the headers', () => {
    expect(buildCsv([]).split('\n')[0]).toBe(CSV_HEADERS.join(','))
  })

  it('includes ISO timestamps, seconds and minutes, cause and ISP', () => {
    const [, row] = rows(buildCsv([completed]))
    expect(row[0]).toBe(new Date(completed.startTime).toLocaleString())
    expect(row.slice(2)).toEqual([
      '2024-01-01T10:00:00.000Z',
      '2024-01-01T11:00:30.000Z',
      '3630',
      '60.50',
      'ISP',
      'Comcast',
    ])
  })

  it('leaves end and duration blank for ongoing outages', () => {
    const [, row] = rows(buildCsv([{ id: 'b', startTime: '2024-01-01T10:00:00.000Z', endTime: null, duration: null, cause: 'local' }]))
    expect(row[1]).toBe('Ongoing')
    expect(row.slice(3)).toEqual(['', '', '', 'Local network', ''])
  })

  it('exports a zero-second outage as 0, not blank', () => {
    const [, row] = rows(buildCsv([{ ...completed, endTime: completed.startTime, duration: 0 }]))
    expect(row[4]).toBe('0')
    expect(row[5]).toBe('0.00')
  })

  it('treats records without a cause as ISP outages', () => {
    const [, row] = rows(buildCsv([{ id: 'c', startTime: '2024-01-01T10:00:00.000Z', endTime: null, duration: null }]))
    expect(row[6]).toBe('ISP')
  })

  it('sorts oldest first', () => {
    const later = { ...completed, id: 'z', startTime: '2024-02-01T10:00:00.000Z' }
    const [, first, second] = rows(buildCsv([later, completed]))
    expect(first[2]).toBe(completed.startTime)
    expect(second[2]).toBe(later.startTime)
  })

  it('escapes quotes', () => {
    expect(buildCsv([{ ...completed, isp: 'Say "hi" ISP' }])).toContain('"Say ""hi"" ISP"')
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

  it('revokes the object URL after the download starts', () => {
    exportToCSV([])
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    jest.runAllTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
