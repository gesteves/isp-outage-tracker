import { STATUS_TAG, notifyStatusChange, statusMessage } from '@/lib/notifications'
import { createSettingsStore } from '@/lib/settings'
import { Outage } from '@/types'

const ended: Outage = {
  id: 'o',
  startTime: '2024-01-01T10:02:00.000Z',
  endTime: '2024-01-01T10:07:12.000Z',
  duration: 312,
  cause: 'isp',
}
const started: Outage = { ...ended, endTime: null, duration: null }

let visibility: DocumentVisibilityState = 'hidden'
const NotificationMock = jest.fn() as jest.Mock & { permission: NotificationPermission }

beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

beforeEach(() => {
  visibility = 'hidden'
  NotificationMock.mockReset()
  NotificationMock.permission = 'granted'
  Object.defineProperty(window, 'Notification', { value: NotificationMock, configurable: true, writable: true })
})

afterEach(() => {
  delete (window as { Notification?: unknown }).Notification
  delete (navigator as { serviceWorker?: unknown }).serviceWorker
})

function enabledSettings() {
  const settings = createSettingsStore()
  settings.set({ notifyOnStatusChange: true })
  return settings
}

describe('statusMessage', () => {
  it('says when the internet went down', () => {
    const { title, body } = statusMessage('down', started)
    expect(title).toBe('Internet is down')
    expect(body).toMatch(/^Since \d/)
  })

  it('says how long it was down, and when, once it is back', () => {
    const { title, body } = statusMessage('up', ended)
    expect(title).toBe('Internet is back')
    expect(body).toMatch(/^Down for 5m 12s \(.+–.+\)$/)
  })

  it('mentions local network outages', () => {
    expect(statusMessage('down', { ...started, cause: 'local' }).body).toMatch(/· Local network$/)
    expect(statusMessage('up', { ...ended, cause: 'local' }).body).toMatch(/· Local network$/)
  })
})

describe('notifyStatusChange', () => {
  it.each([
    ['down', started, 'Internet is down'],
    ['up', ended, 'Internet is back'],
  ] as const)('shows the %s notification when enabled, permitted and hidden', async (change, outage, title) => {
    await notifyStatusChange(change, outage, { settings: enabledSettings() })
    expect(NotificationMock).toHaveBeenCalledWith(title, expect.objectContaining({ tag: STATUS_TAG, renotify: true }))
  })

  it('uses one tag, so "back" replaces "down" instead of stacking', async () => {
    const settings = enabledSettings()
    await notifyStatusChange('down', started, { settings })
    await notifyStatusChange('up', ended, { settings })
    const tags = NotificationMock.mock.calls.map(([, options]) => options.tag)
    expect(tags).toEqual([STATUS_TAG, STATUS_TAG])
  })

  it('goes through the service worker when one is registered', async () => {
    const showNotification = jest.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: async () => ({ showNotification }) },
      configurable: true,
    })
    await notifyStatusChange('up', ended, { settings: enabledSettings() })
    expect(showNotification).toHaveBeenCalledWith('Internet is back', expect.objectContaining({ tag: STATUS_TAG }))
    expect(NotificationMock).not.toHaveBeenCalled()
  })

  it('stays quiet when the setting is off', async () => {
    await notifyStatusChange('down', started, { settings: createSettingsStore() })
    expect(NotificationMock).not.toHaveBeenCalled()
  })

  it('stays quiet without permission', async () => {
    NotificationMock.permission = 'default'
    await notifyStatusChange('down', started, { settings: enabledSettings() })
    expect(NotificationMock).not.toHaveBeenCalled()
  })

  it('stays quiet when the user is looking at the page', async () => {
    visibility = 'visible'
    await notifyStatusChange('down', started, { settings: enabledSettings() })
    expect(NotificationMock).not.toHaveBeenCalled()
  })

  it('does nothing where notifications are unsupported', async () => {
    delete (window as { Notification?: unknown }).Notification
    await expect(notifyStatusChange('up', ended, { settings: enabledSettings() })).resolves.toBeUndefined()
  })
})
