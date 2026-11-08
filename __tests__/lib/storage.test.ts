import { DATA_KEY, LEGACY_KEYS, TrackerData, clearData, emptyData, loadData, saveData, validateOutage } from '@/lib/storage'
import { Outage } from '@/types'

const NOW = Date.parse('2024-01-10T00:00:00Z')

const completed: Outage = {
  id: 'test-1',
  startTime: '2024-01-01T10:00:00.000Z',
  endTime: '2024-01-01T11:00:00.000Z',
  duration: 3600,
  cause: 'isp',
  isp: 'Comcast',
}

describe('storage', () => {
  describe('loadData', () => {
    it('returns empty data when nothing is stored', () => {
      expect(loadData(NOW)).toEqual({ data: emptyData(), changed: false })
    })

    it('round-trips saved data unchanged', () => {
      const data: TrackerData = {
        ...emptyData(),
        outages: [completed],
        trackingStartTime: '2024-01-01T00:00:00.000Z',
        lastCheckAt: NOW - 1000,
        monitoredByDay: { '2024-01-01': 5000 },
        legacyMonitoredMs: 10,
        streak: { consecutiveFailures: 1, firstFailureAt: NOW - 1000, local: false },
      }
      saveData(data)
      expect(loadData(NOW)).toEqual({ data, changed: false })
    })

    it('falls back to empty data on invalid JSON', () => {
      localStorage.setItem(DATA_KEY, 'not json')
      expect(loadData(NOW).data).toEqual(emptyData())
    })

    it('drops malformed outages and fields, and reports the cleanup as a change', () => {
      localStorage.setItem(DATA_KEY, JSON.stringify({
        version: 2,
        outages: [completed, { id: 'bad' }, null, { id: 'x', startTime: 'nope', endTime: null, duration: null }],
        trackingStartTime: 'not a date',
        lastCheckAt: -5,
        monitoredByDay: { '2024-01-01': 100, garbage: 5, '2024-01-02': 'x' },
        streak: { consecutiveFailures: 'two' },
      }))
      const { data, changed } = loadData(NOW)
      expect(changed).toBe(true)
      expect(data.outages).toEqual([completed])
      expect(data.trackingStartTime).toBeNull()
      expect(data.lastCheckAt).toBeNull()
      expect(data.monitoredByDay).toEqual({ '2024-01-01': 100 })
      expect(data.streak.consecutiveFailures).toBe(0)
    })

    it('removes phantom open outages left by the old duplicate bug', () => {
      saveData({
        ...emptyData(),
        outages: [
          { id: 'phantom', startTime: '2024-01-01T09:00:00.000Z', endTime: null, duration: null },
          completed,
        ],
      })
      expect(loadData(NOW).data.outages.map(o => o.id)).toEqual(['test-1'])
    })
  })

  describe('migrating version 1 data', () => {
    beforeEach(() => {
      localStorage.setItem(LEGACY_KEYS.outages, JSON.stringify([
        { id: 'old', startTime: '2024-01-05T10:00:00.000Z', endTime: '2024-01-05T10:30:00.000Z', duration: 1800 },
      ]))
      localStorage.setItem(LEGACY_KEYS.trackingStart, '2024-01-01T00:00:00.000Z')
      localStorage.setItem(LEGACY_KEYS.lastCheck, '2024-01-09T00:00:00.000Z')
    })

    it('reads the separate keys into the new format', () => {
      const { data, changed } = loadData(NOW)
      expect(changed).toBe(true)
      expect(data.version).toBe(2)
      expect(data.outages.map(o => o.id)).toEqual(['old'])
      expect(data.trackingStartTime).toBe('2024-01-01T00:00:00.000Z')
      expect(data.lastCheckAt).toBe(Date.parse('2024-01-09T00:00:00.000Z'))
    })

    it('assumes monitoring was continuous up to the last check, so uptime does not jump', () => {
      expect(loadData(NOW).data.legacyMonitoredMs).toBe(8 * 86400 * 1000)
    })

    it('does not write anything until saved, then removes the old keys', () => {
      const { data } = loadData(NOW)
      expect(localStorage.getItem(DATA_KEY)).toBeNull()
      saveData(data)
      expect(localStorage.getItem(LEGACY_KEYS.outages)).toBeNull()
      expect(localStorage.getItem(LEGACY_KEYS.trackingStart)).toBeNull()
      expect(localStorage.getItem(LEGACY_KEYS.lastCheck)).toBeNull()
      expect(loadData(NOW)).toEqual({ data, changed: false })
    })

    it('prefers the new key when both exist', () => {
      saveData({ ...emptyData(), trackingStartTime: '2024-01-08T00:00:00.000Z' })
      localStorage.setItem(LEGACY_KEYS.trackingStart, '2024-01-01T00:00:00.000Z')
      expect(loadData(NOW).data.trackingStartTime).toBe('2024-01-08T00:00:00.000Z')
    })
  })

  describe('clearData', () => {
    it('removes the data and any legacy keys', () => {
      saveData({ ...emptyData(), outages: [completed] })
      localStorage.setItem(LEGACY_KEYS.outages, '[]')
      clearData()
      expect(localStorage.getItem(DATA_KEY)).toBeNull()
      expect(localStorage.getItem(LEGACY_KEYS.outages)).toBeNull()
    })
  })

  describe('validateOutage', () => {
    it('computes a missing duration from the timestamps', () => {
      expect(validateOutage({ ...completed, duration: null })?.duration).toBe(3600)
    })

    it('drops unknown causes', () => {
      expect(validateOutage({ ...completed, cause: 'aliens' })).not.toHaveProperty('cause')
    })
  })
})
