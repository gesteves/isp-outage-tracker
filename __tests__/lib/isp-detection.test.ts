import { detectISP, clearISPCache } from '@/lib/isp-detection'

describe('isp-detection', () => {
  beforeEach(() => {
    localStorage.clear()
    global.fetch = jest.fn()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('detectISP', () => {
    it('should return cached ISP name if cache is valid', async () => {
      const cachedData = {
        name: 'Cached ISP',
        timestamp: Date.now(),
      }
      localStorage.setItem('isp-name-cache', JSON.stringify(cachedData))
      
      const result = await detectISP()
      
      expect(result).toBe('Cached ISP')
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('should fetch ISP name if cache is expired', async () => {
      const cachedData = {
        name: 'Old ISP',
        timestamp: Date.now() - (2 * 60 * 60 * 1000), // 2 hours ago
      }
      localStorage.setItem('isp-name-cache', JSON.stringify(cachedData))
      
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ org: 'New ISP Provider' }),
      } as Response)
      
      const result = await detectISP()
      
      expect(result).toBe('New ISP Provider')
      expect(global.fetch).toHaveBeenCalledWith(
        'https://ipapi.co/json/',
        expect.any(Object)
      )
    })

    it('should fetch ISP name if no cache exists', async () => {
      // No cache, so don't set anything
      
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ org: 'Test ISP' }),
      } as Response)
      
      const result = await detectISP()
      
      expect(result).toBe('Test ISP')
    })

    it('should clean AS prefix from ISP name', async () => {
      // No cache
      
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ org: 'AS12345 Comcast Cable' }),
      } as Response)
      
      const result = await detectISP()
      
      expect(result).toBe('Comcast Cable')
    })

    it('should return null if API call fails', async () => {
      // No cache
      
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'))
      
      const result = await detectISP()
      
      expect(result).toBeNull()
    })

    it('should return null if API response is not ok', async () => {
      // No cache
      
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
      } as Response)
      
      const result = await detectISP()
      
      expect(result).toBeNull()
    })

    it('should use asn.org as fallback', async () => {
      // No cache
      
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ asn: { org: 'Fallback ISP' } }),
      } as Response)
      
      const result = await detectISP()
      
      expect(result).toBe('Fallback ISP')
    })
  })

  describe('clearISPCache', () => {
    it('should remove ISP cache from localStorage', () => {
      // Set some cache first
      localStorage.setItem('isp-name-cache', JSON.stringify({ name: 'Test', timestamp: Date.now() }))
      
      clearISPCache()
      
      expect(localStorage.getItem('isp-name-cache')).toBeNull()
    })
  })
})

