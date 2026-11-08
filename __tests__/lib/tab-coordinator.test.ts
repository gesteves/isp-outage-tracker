import { CHANNEL_NAME, LOCK_NAME, createTabCoordinator, soloCoordinator } from '@/lib/tab-coordinator'

/** Minimal fake of navigator.locks: one holder, a FIFO queue, AbortSignal support. */
function installFakeLocks() {
  type Pending = { callback: () => Promise<void> | undefined; resolve: () => void; reject: (e: unknown) => void; signal?: AbortSignal }
  const queue: Pending[] = []
  let held = false
  const requested: string[] = []

  const next = () => {
    if (held || queue.length === 0) return
    const item = queue.shift()!
    held = true
    void Promise.resolve().then(async () => {
      try {
        await item.callback()
      } finally {
        held = false
        item.resolve()
        next()
      }
    })
  }

  const locks = {
    request: (name: string, options: { signal?: AbortSignal }, callback: () => Promise<void> | undefined) =>
      new Promise<void>((resolve, reject) => {
        requested.push(name)
        const item: Pending = { callback, resolve, reject, signal: options.signal }
        options.signal?.addEventListener('abort', () => {
          const index = queue.indexOf(item)
          if (index !== -1) {
            queue.splice(index, 1)
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          }
        })
        queue.push(item)
        next()
      }),
  }
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
  return { requested, isHeld: () => held }
}

/** Minimal fake BroadcastChannel that delivers to other instances with the same name. */
class FakeChannel {
  static instances: FakeChannel[] = []
  listeners = new Set<(event: MessageEvent) => void>()
  constructor(public name: string) {
    FakeChannel.instances.push(this)
  }
  postMessage(data: unknown) {
    FakeChannel.instances
      .filter(c => c !== this && c.name === this.name)
      .forEach(c => c.listeners.forEach(l => l({ data } as MessageEvent)))
  }
  addEventListener(_: string, l: (event: MessageEvent) => void) {
    this.listeners.add(l)
  }
  removeEventListener(_: string, l: (event: MessageEvent) => void) {
    this.listeners.delete(l)
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('tab coordinator', () => {
  const originalChannel = global.BroadcastChannel

  afterEach(() => {
    delete (navigator as { locks?: unknown }).locks
    global.BroadcastChannel = originalChannel
    FakeChannel.instances = []
  })

  describe('fallback', () => {
    it('leads immediately when Web Locks are unavailable', () => {
      const coordinator = createTabCoordinator()
      expect(coordinator.shared).toBe(false)
      const onAcquired = jest.fn()
      coordinator.requestLeadership(onAcquired)
      expect(onAcquired).toHaveBeenCalledTimes(1)
    })

    it('soloCoordinator never delivers messages', () => {
      const coordinator = soloCoordinator()
      const listener = jest.fn()
      coordinator.onMessage(listener)
      coordinator.post({ type: 'hello' })
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('with Web Locks and BroadcastChannel', () => {
    beforeEach(() => {
      global.BroadcastChannel = FakeChannel as unknown as typeof BroadcastChannel
    })

    it('grants leadership to one tab at a time, in order', async () => {
      const locks = installFakeLocks()
      const a = createTabCoordinator()
      const b = createTabCoordinator()
      expect(a.shared).toBe(true)

      const aLeads = jest.fn()
      const bLeads = jest.fn()
      const releaseA = a.requestLeadership(aLeads)
      b.requestLeadership(bLeads)
      await flush()
      expect(locks.requested).toEqual([LOCK_NAME, LOCK_NAME])
      expect(aLeads).toHaveBeenCalled()
      expect(bLeads).not.toHaveBeenCalled()

      releaseA()
      await flush()
      expect(bLeads).toHaveBeenCalled()
    })

    it('cancels a request that has not been granted yet (StrictMode unmount)', async () => {
      const locks = installFakeLocks()
      const a = createTabCoordinator()
      const b = createTabCoordinator()
      const releaseA = a.requestLeadership(() => {})
      const bLeads = jest.fn()
      const cancelB = b.requestLeadership(bLeads)
      cancelB()
      await flush()
      releaseA()
      await flush()
      expect(bLeads).not.toHaveBeenCalled()
      expect(locks.isHeld()).toBe(false)
    })

    it('does not lead if released before the grant callback runs', async () => {
      const locks = installFakeLocks()
      const onAcquired = jest.fn()
      const release = createTabCoordinator().requestLeadership(onAcquired)
      release() // the grant is already queued in a microtask
      await flush()
      expect(onAcquired).not.toHaveBeenCalled()
      expect(locks.isHeld()).toBe(false)
    })

    it('delivers messages to other tabs on the shared channel', () => {
      installFakeLocks()
      const a = createTabCoordinator<string>()
      const b = createTabCoordinator<string>()
      const received = jest.fn()
      const stop = b.onMessage(received)

      a.post({ type: 'snapshot', snapshot: 'hi' })
      expect(received).toHaveBeenCalledWith({ type: 'snapshot', snapshot: 'hi' })
      expect(FakeChannel.instances.every(c => c.name === CHANNEL_NAME)).toBe(true)

      stop()
      a.post({ type: 'hello' })
      expect(received).toHaveBeenCalledTimes(1)
    })
  })
})
