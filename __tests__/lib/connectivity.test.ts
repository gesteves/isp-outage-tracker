import { checkConnectivity } from '@/lib/connectivity'

describe('connectivity', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('checkConnectivity', () => {
    it('should return true if at least one endpoint succeeds', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true } as Response) // 1.1.1.1 succeeds
        .mockRejectedValueOnce(new Error('Failed')) // 8.8.8.8 fails
        .mockRejectedValueOnce(new Error('Failed')) // cloudflare.com fails
        .mockRejectedValueOnce(new Error('Failed')) // /api/health fails
      
      const result = await checkConnectivity()
      
      expect(result).toBe(true)
    })

    it('should return false if all endpoints fail', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'))
      
      const result = await checkConnectivity()
      
      expect(result).toBe(false)
    })

    it('should return true if multiple endpoints succeed', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response)
      
      const result = await checkConnectivity()
      
      expect(result).toBe(true)
    })

    it('should use no-cors mode for requests', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response)
      
      await checkConnectivity()
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          mode: 'no-cors',
          cache: 'no-store',
        })
      )
    })
  })
})

