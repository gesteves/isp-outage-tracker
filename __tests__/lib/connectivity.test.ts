import { checkConnectivity } from '@/lib/connectivity'

const IPS = ['https://1.1.1.1', 'https://8.8.8.8']
const NAMES = ['https://cloudflare.com', 'https://google.com']

/** Only the given targets answer, each after its delay (ms); everything else fails. */
function reachable(answers: Record<string, number>) {
  global.fetch = jest.fn((url: RequestInfo | URL) => {
    const delay = answers[String(url)]
    if (delay === undefined) return Promise.reject(new Error('Failed'))
    return new Promise<Response>(resolve => setTimeout(() => resolve({} as Response), delay))
  })
}

const instantly = (urls: string[]) => Object.fromEntries(urls.map(url => [url, 0]))

/** Runs a check to completion under fake timers. */
async function check() {
  const result = checkConnectivity()
  await jest.advanceTimersByTimeAsync(10_000)
  return result
}

describe('checkConnectivity', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('is online when a site reached by name answers', async () => {
    reachable(instantly(['https://google.com']))
    const result = await check()
    expect(result).toMatchObject({ online: true })
    expect(result).not.toHaveProperty('failure')
  })

  it('is online when everything answers', async () => {
    reachable(instantly([...IPS, ...NAMES]))
    expect(await check()).toMatchObject({ online: true })
  })

  it('is a DNS failure when only the IP addresses answer', async () => {
    reachable(instantly(['https://1.1.1.1']))
    expect(await check()).toMatchObject({ online: false, failure: 'dns' })
  })

  it('fails completely when nothing answers', async () => {
    reachable({})
    expect(await check()).toEqual({ online: false, failure: 'all', latencyMs: null })
  })

  it('treats a target that times out as failed', async () => {
    global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === 'https://8.8.8.8') return Promise.resolve({} as Response)
      // Never answers on its own; only the abort ends it.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')))
      })
    })
    expect(await check()).toMatchObject({ online: false, failure: 'dns' })
  })

  it('reports the fastest response time', async () => {
    reachable({ 'https://1.1.1.1': 80, 'https://google.com': 30, 'https://cloudflare.com': 55 })
    expect(await check()).toMatchObject({ online: true, latencyMs: 30 })
  })

  it('sends uncached no-cors HEAD requests to every target', async () => {
    reachable(instantly([...IPS, ...NAMES]))
    await check()
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => url).sort()).toEqual([...IPS, ...NAMES].sort())
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'HEAD', mode: 'no-cors', cache: 'no-store' }),
    )
  })
})
