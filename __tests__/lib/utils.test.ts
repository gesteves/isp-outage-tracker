import { calculateStats, formatDurationFromSeconds, formatPercentage, exportToCSV } from '@/lib/utils'
import { Outage } from '@/types'

describe('utils', () => {
  describe('calculateStats', () => {
    it('should return default stats when no tracking start time', () => {
      const stats = calculateStats([], null)
      
      expect(stats).toEqual({
        totalOutages: 0,
        totalDowntime: 0,
        uptimePercentage: 100,
        trackingStartTime: null,
      })
    })

    it('should calculate stats correctly with completed outages', () => {
      const trackingStart = new Date('2024-01-01T00:00:00Z').toISOString()
      const outages: Outage[] = [
        {
          id: 'test-1',
          startTime: new Date('2024-01-01T10:00:00Z').toISOString(),
          endTime: new Date('2024-01-01T11:00:00Z').toISOString(),
          duration: 3600, // 1 hour
        },
      ]
      
      // Mock current time to be 24 hours after tracking start
      jest.spyOn(Date, 'now').mockReturnValue(new Date('2024-01-02T00:00:00Z').getTime())
      
      const stats = calculateStats(outages, trackingStart)
      
      expect(stats.totalOutages).toBe(1)
      expect(stats.totalDowntime).toBe(3600)
      // 1 hour down out of 24 hours = ~95.83% uptime
      expect(stats.uptimePercentage).toBeGreaterThan(95)
      expect(stats.uptimePercentage).toBeLessThan(96)
      
      jest.restoreAllMocks()
    })

    it('should calculate stats with ongoing outage', () => {
      const trackingStart = new Date('2024-01-01T00:00:00Z').toISOString()
      const outageStart = new Date('2024-01-01T10:00:00Z')
      const outages: Outage[] = [
        {
          id: 'test-1',
          startTime: outageStart.toISOString(),
          endTime: null,
          duration: null,
        },
      ]
      
      // Mock current time to be 1 hour after outage start
      const now = new Date('2024-01-01T11:00:00Z')
      jest.spyOn(Date, 'now').mockReturnValue(now.getTime())
      
      const stats = calculateStats(outages, trackingStart)
      
      expect(stats.totalOutages).toBe(1)
      expect(stats.totalDowntime).toBe(3600) // 1 hour in seconds
      
      jest.restoreAllMocks()
    })

    it('should accept an explicit now instead of reading the clock', () => {
      const trackingStart = '2024-01-01T00:00:00Z'
      const outages: Outage[] = [
        { id: 'test-1', startTime: '2024-01-01T23:00:00Z', endTime: null, duration: null },
      ]

      const stats = calculateStats(outages, trackingStart, Date.parse('2024-01-02T00:00:00Z'))

      expect(stats.totalDowntime).toBe(3600)
      expect(stats.uptimePercentage).toBeCloseTo((23 / 24) * 100)
    })

    it('should return 100% uptime with no outages', () => {
      const trackingStart = new Date('2024-01-01T00:00:00Z').toISOString()
      jest.spyOn(Date, 'now').mockReturnValue(new Date('2024-01-02T00:00:00Z').getTime())
      
      const stats = calculateStats([], trackingStart)
      
      expect(stats.totalOutages).toBe(0)
      expect(stats.totalDowntime).toBe(0)
      expect(stats.uptimePercentage).toBe(100)
      
      jest.restoreAllMocks()
    })
  })

  describe('formatDurationFromSeconds', () => {
    it('should format 0 seconds', () => {
      expect(formatDurationFromSeconds(0)).toBe('0s')
    })

    it('should format seconds only', () => {
      expect(formatDurationFromSeconds(45)).toBe('45s')
    })

    it('should format minutes and seconds', () => {
      expect(formatDurationFromSeconds(90)).toBe('1m 30s')
    })

    it('should format hours, minutes, and seconds', () => {
      expect(formatDurationFromSeconds(3665)).toBe('1h 1m 5s')
    })

    it('should format hours and minutes without seconds', () => {
      expect(formatDurationFromSeconds(3660)).toBe('1h 1m')
    })

    it('should format multiple hours', () => {
      expect(formatDurationFromSeconds(7325)).toBe('2h 2m 5s')
    })

    it('should keep counting days past a month', () => {
      // date-fns intervalToDuration used to fold these into months and drop them.
      expect(formatDurationFromSeconds(31 * 86400 + 5)).toBe('31d 5s')
      expect(formatDurationFromSeconds(45 * 86400)).toBe('45d')
      expect(formatDurationFromSeconds(400 * 86400 + 3600)).toBe('400d 1h')
    })

    it('should drop fractional seconds', () => {
      expect(formatDurationFromSeconds(90.9)).toBe('1m 30s')
      expect(formatDurationFromSeconds(0.4)).toBe('0s')
    })
  })

  describe('formatPercentage', () => {
    it('should round down so any downtime stays below 100%', () => {
      expect(formatPercentage(99.996)).toBe('99.99')
      expect(formatPercentage(100)).toBe('100.00')
    })

    it('should not lose a hundredth to floating point error', () => {
      expect(formatPercentage(0.29)).toBe('0.29')
      expect(formatPercentage(1.13)).toBe('1.13')
      expect(formatPercentage(95.83)).toBe('95.83')
    })
  })

  describe('exportToCSV', () => {
    let link: HTMLAnchorElement
    let clickSpy: jest.SpyInstance
    let blobs: Blob[]

    beforeEach(() => {
      blobs = []
      const realCreateElement = document.createElement.bind(document)
      jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'a') link = el as HTMLAnchorElement
        return el
      })
      clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      global.URL.createObjectURL = jest.fn((blob: Blob) => {
        blobs.push(blob)
        return 'blob:mock-url'
      })
      global.URL.revokeObjectURL = jest.fn()
    })

    afterEach(() => {
      jest.useRealTimers()
      jest.restoreAllMocks()
    })

    // jsdom's Blob has no .text(), so read it the old-fashioned way.
    const csvText = () =>
      new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsText(blobs[0])
      })

    it('should create and download CSV file', async () => {
      const outages: Outage[] = [
        {
          id: 'test-1',
          startTime: new Date('2024-01-01T10:00:00Z').toISOString(),
          endTime: new Date('2024-01-01T11:00:00Z').toISOString(),
          duration: 3600,
        },
      ]

      exportToCSV(outages)

      expect(clickSpy).toHaveBeenCalled()
      expect(link.getAttribute('download')).toMatch(/^isp-outages-\d{4}-\d{2}-\d{2}\.csv$/)
      expect(document.body.contains(link)).toBe(false)
      const lines = (await csvText()).split('\n')
      expect(lines[0]).toBe('Start Time,End Time,Duration (minutes)')
      expect(lines[1]).toMatch(/"60\.00"$/)
    })

    it('should handle ongoing outages in CSV', async () => {
      const outages: Outage[] = [
        {
          id: 'test-1',
          startTime: new Date('2024-01-01T10:00:00Z').toISOString(),
          endTime: null,
          duration: null,
        },
      ]

      exportToCSV(outages)

      expect(clickSpy).toHaveBeenCalled()
      expect((await csvText()).split('\n')[1]).toMatch(/"Ongoing","N\/A"$/)
    })

    it('should export a zero-second outage as 0.00, not N/A', async () => {
      const outages: Outage[] = [
        {
          id: 'test-1',
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:00:00Z',
          duration: 0,
        },
      ]

      exportToCSV(outages)

      expect((await csvText()).split('\n')[1]).toMatch(/"0\.00"$/)
    })

    it('should revoke the object URL after the download starts', () => {
      jest.useFakeTimers()
      exportToCSV([])

      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      jest.runAllTimers()
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })
  })
})

