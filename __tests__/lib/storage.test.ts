import { storage } from '@/lib/storage'
import { Outage } from '@/types'

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getOutages', () => {
    it('should return empty array when no outages stored', () => {
      expect(storage.getOutages()).toEqual([])
    })

    it('should return parsed outages from localStorage', () => {
      const mockOutages: Outage[] = [
        {
          id: 'test-1',
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T11:00:00Z',
          duration: 3600,
        },
      ]
      storage.setOutages(mockOutages)
      
      expect(storage.getOutages()).toEqual(mockOutages)
    })

    it('should return empty array if JSON parsing fails', () => {
      localStorage.setItem('isp-outages', 'invalid json')
      expect(storage.getOutages()).toEqual([])
    })
  })

  describe('setOutages', () => {
    it('should store outages in localStorage', () => {
      const mockOutages: Outage[] = [
        {
          id: 'test-1',
          startTime: '2024-01-01T10:00:00Z',
          endTime: null,
          duration: null,
        },
      ]
      
      storage.setOutages(mockOutages)
      
      expect(storage.getOutages()).toEqual(mockOutages)
    })
  })

  describe('addOutage', () => {
    it('should add a new outage to existing outages', () => {
      const existingOutages: Outage[] = [
        {
          id: 'test-1',
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T11:00:00Z',
          duration: 3600,
        },
      ]
      const newOutage: Outage = {
        id: 'test-2',
        startTime: '2024-01-01T12:00:00Z',
        endTime: null,
        duration: null,
      }
      
      storage.setOutages(existingOutages)
      storage.addOutage(newOutage)
      
      const result = storage.getOutages()
      expect(result).toHaveLength(2)
      expect(result[1]).toEqual(newOutage)
    })
  })

  describe('updateOutage', () => {
    it('should update an existing outage', () => {
      const outages: Outage[] = [
        {
          id: 'test-1',
          startTime: '2024-01-01T10:00:00Z',
          endTime: null,
          duration: null,
        },
      ]
      
      storage.setOutages(outages)
      
      storage.updateOutage('test-1', {
        endTime: '2024-01-01T11:00:00Z',
        duration: 3600,
      })
      
      const result = storage.getOutages()
      expect(result[0]).toEqual({
        id: 'test-1',
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T11:00:00Z',
        duration: 3600,
      })
    })
  })

  describe('clearOutages', () => {
    it('should remove outages and tracking start time from localStorage', () => {
      // Set some data first
      storage.setOutages([{ id: 'test', startTime: '2024-01-01', endTime: null, duration: null }])
      storage.setTrackingStartTime('2024-01-01')
      
      storage.clearOutages()
      
      expect(storage.getOutages()).toEqual([])
      expect(storage.getTrackingStartTime()).toBeNull()
    })
  })

  describe('getTrackingStartTime', () => {
    it('should return tracking start time from localStorage', () => {
      const time = '2024-01-01T00:00:00Z'
      storage.setTrackingStartTime(time)
      
      expect(storage.getTrackingStartTime()).toBe(time)
    })

    it('should return null if not set', () => {
      expect(storage.getTrackingStartTime()).toBeNull()
    })
  })

  describe('setTrackingStartTime', () => {
    it('should store tracking start time in localStorage', () => {
      const time = '2024-01-01T00:00:00Z'
      
      storage.setTrackingStartTime(time)
      
      expect(storage.getTrackingStartTime()).toBe(time)
    })
  })
})

