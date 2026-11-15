import { detectISP, clearISPCache } from '@/lib/isp-detection'

const CACHE_KEY = 'isp-name-cache'

function respond(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => body } as Response)
}

describe('isp-detection', () => {
  beforeEach(() => {
    localStorage.clear()
    global.fetch = jest.fn()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('detectISP', () => {
    it('returns the cached network info while the cache is fresh', async () => {
      const cached = { name: 'Cached ISP', ip: '203.0.113.7', asn: 'AS7922', timestamp: Date.now() }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cached))

      expect(await detectISP()).toEqual({ name: 'Cached ISP', ip: '203.0.113.7', asn: 'AS7922' })
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('fetches again once the cache is an hour old', async () => {
      const cached = { name: 'Old ISP', ip: null, asn: null, timestamp: Date.now() - 2 * 60 * 60 * 1000 }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cached))
      respond({ org: 'New ISP Provider' })

      expect((await detectISP())?.name).toBe('New ISP Provider')
      expect(global.fetch).toHaveBeenCalledWith('https://ipapi.co/json/', expect.any(Object))
    })

    it('fetches again when the cache is from before IPs were recorded', async () => {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ name: 'Cached ISP', timestamp: Date.now() }))
      respond({ org: 'Comcast', ip: '203.0.113.7', asn: 'AS7922' })

      expect(await detectISP()).toEqual({ name: 'Comcast', ip: '203.0.113.7', asn: 'AS7922' })
      expect(global.fetch).toHaveBeenCalled()
    })

    it('skips the cache when forced', async () => {
      const cached = { name: 'Cached ISP', ip: null, asn: null, timestamp: Date.now() }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cached))
      respond({ org: 'Backup LTE' })

      expect((await detectISP({ force: true }))?.name).toBe('Backup LTE')
    })

    it('returns the ISP name, public IP and ASN, and caches them', async () => {
      respond({ org: 'Comcast Cable', ip: '203.0.113.7', asn: 'AS7922' })

      expect(await detectISP()).toEqual({ name: 'Comcast Cable', ip: '203.0.113.7', asn: 'AS7922' })
      expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toMatchObject({
        name: 'Comcast Cable',
        ip: '203.0.113.7',
        asn: 'AS7922',
      })
    })

    it('cleans the AS prefix from the name, and uses it as the ASN when there is no other', async () => {
      respond({ org: 'AS12345 Comcast Cable' })

      expect(await detectISP()).toEqual({ name: 'Comcast Cable', ip: null, asn: 'AS12345' })
    })

    it('uses asn.org as a fallback name, and a numeric asn.asn', async () => {
      respond({ asn: { org: 'Fallback ISP', asn: 21928 } })

      expect(await detectISP()).toEqual({ name: 'Fallback ISP', ip: null, asn: 'AS21928' })
    })

    it('ignores an ASN it cannot read', async () => {
      respond({ org: 'Comcast', asn: 'unknown' })

      expect((await detectISP())?.asn).toBeNull()
    })

    it('returns null if the API call fails', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'))

      expect(await detectISP()).toBeNull()
    })

    it('returns null if the API response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false } as Response)

      expect(await detectISP()).toBeNull()
    })

    it('returns null, and caches nothing, when the response has neither a name nor an IP', async () => {
      respond({ city: 'Somewhere' })

      expect(await detectISP()).toBeNull()
      expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    })
  })

  describe('clearISPCache', () => {
    it('should remove ISP cache from localStorage', () => {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ name: 'Test', timestamp: Date.now() }))

      clearISPCache()

      expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    })
  })
})
