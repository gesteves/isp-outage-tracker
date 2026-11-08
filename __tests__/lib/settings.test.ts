import { DEFAULT_SETTINGS, SETTINGS_KEY, createSettingsStore } from '@/lib/settings'

describe('settings store', () => {
  it('defaults everything off', () => {
    expect(createSettingsStore().get()).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS).toEqual({ keepScreenOn: false, notifyOnStatusChange: false })
  })

  it('persists changes with a version number', () => {
    const store = createSettingsStore()
    store.set({ keepScreenOn: true })
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toEqual({
      version: 1,
      keepScreenOn: true,
      notifyOnStatusChange: false,
    })
    expect(createSettingsStore().get().keepScreenOn).toBe(true)
  })

  it('returns a stable snapshot until something changes', () => {
    const store = createSettingsStore()
    const first = store.get()
    expect(store.get()).toBe(first)
    store.set({ notifyOnStatusChange: true })
    expect(store.get()).not.toBe(first)
  })

  it('ignores malformed values', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ keepScreenOn: 'yes', notifyOnStatusChange: true }))
    expect(createSettingsStore().get()).toEqual({ keepScreenOn: false, notifyOnStatusChange: true })
    localStorage.setItem(SETTINGS_KEY, '{oops')
    expect(createSettingsStore().get()).toEqual(DEFAULT_SETTINGS)
  })

  it('notifies subscribers, including when another tab changes the settings', () => {
    const store = createSettingsStore()
    const listener = jest.fn()
    const unsubscribe = store.subscribe(listener)

    store.set({ keepScreenOn: true })
    expect(listener).toHaveBeenCalledTimes(1)

    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, keepScreenOn: false, notifyOnStatusChange: true }))
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.get()).toEqual({ keepScreenOn: false, notifyOnStatusChange: true })

    unsubscribe()
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }))
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
