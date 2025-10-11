import { calculateStats, formatDurationFromSeconds, exportToCSV } from '@/lib/utils'
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
  })

  describe('exportToCSV', () => {
    let createElementSpy: jest.SpyInstance
    let appendChildSpy: jest.SpyInstance
    let removeChildSpy: jest.SpyInstance
    let clickSpy: jest.Mock

    beforeEach(() => {
      clickSpy = jest.fn()
      const mockLink = {
        setAttribute: jest.fn(),
        click: clickSpy,
        style: {},
      }
      
      createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(mockLink as any)
      appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as any)
      removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as any)
      
      global.URL.createObjectURL = jest.fn(() => 'blob:mock-url')
    })

    afterEach(() => {
      createElementSpy.mockRestore()
      appendChildSpy.mockRestore()
      removeChildSpy.mockRestore()
    })

    it('should create and download CSV file', () => {
      const outages: Outage[] = [
        {
          id: 'test-1',
          startTime: new Date('2024-01-01T10:00:00Z').toISOString(),
          endTime: new Date('2024-01-01T11:00:00Z').toISOString(),
          duration: 3600,
        },
      ]
      
      exportToCSV(outages)
      
      expect(createElementSpy).toHaveBeenCalledWith('a')
      expect(clickSpy).toHaveBeenCalled()
      expect(appendChildSpy).toHaveBeenCalled()
      expect(removeChildSpy).toHaveBeenCalled()
    })

    it('should handle ongoing outages in CSV', () => {
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
    })
  })
})

