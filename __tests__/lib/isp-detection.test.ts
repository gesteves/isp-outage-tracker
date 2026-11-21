import { detectISP, clearISPCache, ipFamily } from '@/lib/isp-detection'

const CACHE_KEY = 'isp-name-cache'
const ISP_URL = 'https://ipapi.co/json/'
const IPV4_URL = 'https://api.ipify.org?format=json'
const IPV6_URL = 'https://api6.ipify.org?format=json'

/** Answers each lookup by URL; a URL without a body fails, like an IPv6 lookup without IPv6. */
function respond(bodies: { isp?: unknown; ipv4?: string; ipv6?: string }) {
  const byUrl: Record<string, unknown> = {
    [ISP_URL]: bodies.isp,
    [IPV4_URL]: bodies.ipv4 && { ip: bodies.ipv4 },
    [IPV6_URL]: bodies.ipv6 && { ip: bodies.ipv6 },
  }
  global.fetch = jest.fn(async (url: string) => {
    const body = byUrl[url]
    if (body === undefined) throw new TypeError('Failed to fetch')
    return { ok: true, json: async () => body } as Response
  }) as unknown as typeof fetch
}

describe('isp-detection', () => {
  beforeEach(() => {
    localStorage.clear()
    global.fetch = jest.fn()
    jest.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('detectISP', () => {
    it('returns the cached network info while the cache is fresh', async () => {
      const cached = { name: 'Cached ISP', ipv4: '203.0.113.7', ipv6: null, asn: 'AS7922', timestamp: Date.now() }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cached))

      expect(await detectISP()).toEqual({ name: 'Cached ISP', ipv4: '203.0.113.7', ipv6: null, asn: 'AS7922' })
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('fetches again once the cache is an hour old', async () => {
      const cached = { name: 'Old ISP', ipv4: null, ipv6: null, asn: null, timestamp: Date.now() - 2 * 60 * 60 * 1000 }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cached))
      respond({ isp: { org: 'New ISP Provider' } })

      expect((await detectISP())?.name).toBe('New ISP Provider')
      expect(global.fetch).toHaveBeenCalledWith(ISP_URL, expect.any(Object))
    })

    it('fetches again when the cache is from before IPv4 and IPv6 were looked up separately', async () => {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ name: 'Cached ISP', ip: '203.0.113.7', asn: null, timestamp: Date.now() }))
      respond({ isp: { org: 'Comcast', asn: 'AS7922' }, ipv4: '203.0.113.7' })

      expect(await detectISP()).toEqual({ name: 'Comcast', ipv4: '203.0.113.7', ipv6: null, asn: 'AS7922' })
      expect(global.fetch).toHaveBeenCalled()
    })

    it('skips the cache when forced', async () => {
      const cached = { name: 'Cached ISP', ipv4: null, ipv6: null, asn: null, timestamp: Date.now() }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cached))
      respond({ isp: { org: 'Backup LTE' } })

      expect((await detectISP({ force: true }))?.name).toBe('Backup LTE')
    })

    it('looks up IPv4 and IPv6 separately, and caches everything', async () => {
      respond({ isp: { org: 'Comcast Cable', ip: '2001:db8::7', asn: 'AS7922' }, ipv4: '203.0.113.7', ipv6: '2001:db8::7' })

      const expected = { name: 'Comcast Cable', ipv4: '203.0.113.7', ipv6: '2001:db8::7', asn: 'AS7922' }
      expect(await detectISP()).toEqual(expected)
      expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toMatchObject(expected)
    })

    it('leaves IPv6 blank when the connection has none', async () => {
      respond({ isp: { org: 'Comcast', ip: '203.0.113.7' }, ipv4: '203.0.113.7' })

      expect(await detectISP()).toMatchObject({ ipv4: '203.0.113.7', ipv6: null })
    })

    it("fills in an address from the ISP lookup when its family's own lookup failed", async () => {
      respond({ isp: { org: 'Comcast', ip: '2001:db8::9' }, ipv4: '203.0.113.7' })
      expect(await detectISP({ force: true })).toMatchObject({ ipv4: '203.0.113.7', ipv6: '2001:db8::9' })

      respond({ isp: { org: 'Comcast', ip: '203.0.113.8' } })
      expect(await detectISP({ force: true })).toMatchObject({ ipv4: '203.0.113.8', ipv6: null })
    })

    it('ignores an address of the wrong family', async () => {
      respond({ isp: { org: 'Comcast' }, ipv4: '2001:db8::7', ipv6: '203.0.113.7' })

      expect(await detectISP()).toMatchObject({ ipv4: null, ipv6: null })
    })

    it('cleans the AS prefix from the name, and uses it as the ASN when there is no other', async () => {
      respond({ isp: { org: 'AS12345 Comcast Cable' } })

      expect(await detectISP()).toEqual({ name: 'Comcast Cable', ipv4: null, ipv6: null, asn: 'AS12345' })
    })

    it('uses asn.org as a fallback name, and a numeric asn.asn', async () => {
      respond({ isp: { asn: { org: 'Fallback ISP', asn: 21928 } } })

      expect(await detectISP()).toEqual({ name: 'Fallback ISP', ipv4: null, ipv6: null, asn: 'AS21928' })
    })

    it('ignores an ASN it cannot read', async () => {
      respond({ isp: { org: 'Comcast', asn: 'unknown' } })

      expect((await detectISP())?.asn).toBeNull()
    })

    it('still finds the addresses when the ISP lookup fails', async () => {
      respond({ ipv4: '203.0.113.7' })

      expect(await detectISP()).toEqual({ name: null, ipv4: '203.0.113.7', ipv6: null, asn: null })
    })

    it('returns null if every lookup fails', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'))

      expect(await detectISP()).toBeNull()
    })

    it('returns null if the responses are not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false } as Response)

      expect(await detectISP()).toBeNull()
    })

    it('returns null, and caches nothing, when nothing has a name or an IP', async () => {
      respond({ isp: { city: 'Somewhere' } })

      expect(await detectISP()).toBeNull()
      expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    })
  })

  describe('ipFamily', () => {
    it('tells IPv4 from IPv6', () => {
      expect(ipFamily('203.0.113.7')).toBe('v4')
      expect(ipFamily('2605:c900:8004:13b0::1')).toBe('v6')
      expect(ipFamily('nonsense')).toBeNull()
      expect(ipFamily(null)).toBeNull()
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
