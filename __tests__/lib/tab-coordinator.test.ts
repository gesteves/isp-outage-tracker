import { CHANNEL_NAME, LOCK_NAME, createTabCoordinator, soloCoordinator } from '@/lib/tab-coordinator'

/** Minimal fake of navigator.locks: one holder, a FIFO queue, AbortSignal and steal support. */
function installFakeLocks() {
  type Pending = { callback: () => Promise<void> | undefined; resolve: () => void; reject: (e: unknown) => void }
  const queue: Pending[] = []
  let holder: Pending | null = null
  const requested: string[] = []
  const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

  const grant = (item: Pending) => {
    holder = item
    void Promise.resolve().then(async () => {
      try {
        await item.callback()
      } finally {
        // A stolen lock was already handed over; its callback finishing changes nothing.
        if (holder === item) {
          holder = null
          item.resolve()
          next()
        }
      }
    })
  }

  const next = () => {
    if (holder || queue.length === 0) return
    grant(queue.shift()!)
  }

  const locks = {
    request: (
      name: string,
      options: { signal?: AbortSignal; steal?: boolean },
      callback: () => Promise<void> | undefined,
    ) =>
      new Promise<void>((resolve, reject) => {
        requested.push(name)
        const item: Pending = { callback, resolve, reject }
        if (options.steal) {
          const previous = holder
          holder = null
          previous?.reject(abortError())
          grant(item)
          return
        }
        options.signal?.addEventListener('abort', () => {
          const index = queue.indexOf(item)
          if (index !== -1) {
            queue.splice(index, 1)
            reject(abortError())
          }
        })
        queue.push(item)
        next()
      }),
  }
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
  return { requested, isHeld: () => holder !== null }
}

const callbacks = (onAcquired: () => void = () => {}, onLost: () => void = () => {}) => ({ onAcquired, onLost })

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
      const leadership = coordinator.requestLeadership(callbacks(onAcquired))
      expect(onAcquired).toHaveBeenCalledTimes(1)
      expect(() => leadership.takeOver()).not.toThrow()
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
      const leaderA = a.requestLeadership(callbacks(aLeads))
      b.requestLeadership(callbacks(bLeads))
      await flush()
      expect(locks.requested).toEqual([LOCK_NAME, LOCK_NAME])
      expect(aLeads).toHaveBeenCalled()
      expect(bLeads).not.toHaveBeenCalled()

      leaderA.release()
      await flush()
      expect(bLeads).toHaveBeenCalled()
    })

    it('cancels a request that has not been granted yet (StrictMode unmount)', async () => {
      const locks = installFakeLocks()
      const a = createTabCoordinator()
      const b = createTabCoordinator()
      const leaderA = a.requestLeadership(callbacks())
      const bLeads = jest.fn()
      const waitingB = b.requestLeadership(callbacks(bLeads))
      waitingB.release()
      await flush()
      leaderA.release()
      await flush()
      expect(bLeads).not.toHaveBeenCalled()
      expect(locks.isHeld()).toBe(false)
    })

    it('does not lead if released before the grant callback runs', async () => {
      const locks = installFakeLocks()
      const onAcquired = jest.fn()
      const leadership = createTabCoordinator().requestLeadership(callbacks(onAcquired))
      leadership.release() // the grant is already queued in a microtask
      await flush()
      expect(onAcquired).not.toHaveBeenCalled()
      expect(locks.isHeld()).toBe(false)
    })

    it('takes over from a leader that stopped responding, which then waits to lead again', async () => {
      installFakeLocks()
      const a = createTabCoordinator()
      const b = createTabCoordinator()
      const aLeads = jest.fn()
      const aLost = jest.fn()
      const bLeads = jest.fn()
      a.requestLeadership(callbacks(aLeads, aLost))
      const leaderB = b.requestLeadership(callbacks(bLeads))
      await flush()
      expect(aLeads).toHaveBeenCalledTimes(1)

      leaderB.takeOver()
      await flush()
      expect(bLeads).toHaveBeenCalledTimes(1)
      expect(aLost).toHaveBeenCalledTimes(1)

      // When the new leader's tab closes, the old one is back in line.
      leaderB.release()
      await flush()
      expect(aLeads).toHaveBeenCalledTimes(2)
    })

    it('ignores a takeover by the tab that already leads, or after release', async () => {
      installFakeLocks()
      const onAcquired = jest.fn()
      const onLost = jest.fn()
      const leadership = createTabCoordinator().requestLeadership(callbacks(onAcquired, onLost))
      await flush()
      leadership.takeOver()
      await flush()
      expect(onAcquired).toHaveBeenCalledTimes(1)
      expect(onLost).not.toHaveBeenCalled()

      leadership.release()
      leadership.takeOver()
      await flush()
      expect(onAcquired).toHaveBeenCalledTimes(1)
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
