import { act, fireEvent, render, screen } from '@testing-library/react'
import NotificationToggle from '@/components/NotificationToggle'

let permission: NotificationPermission = 'default'
const requestPermission = jest.fn(async () => permission)

class FakeNotification {
  static get permission() {
    return permission
  }
  static requestPermission = requestPermission
}

/** A Permissions API status the test can fire 'change' on. */
const status = new EventTarget()

beforeEach(() => {
  permission = 'default'
  requestPermission.mockClear()
  Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true })
})

afterEach(() => {
  delete (window as { Notification?: unknown }).Notification
  delete (navigator as { permissions?: unknown }).permissions
})

describe('NotificationToggle', () => {
  it('asks for permission when turned on', async () => {
    const onChange = jest.fn()
    render(<NotificationToggle enabled={false} onChange={onChange} />)
    permission = 'granted'
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Notify when status changes' }))
    })
    expect(requestPermission).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('explains a refusal', async () => {
    const onChange = jest.fn()
    render(<NotificationToggle enabled={false} onChange={onChange} />)
    permission = 'denied'
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'))
    })
    expect(onChange).toHaveBeenCalledWith(false)
    expect(screen.getByText(/blocked in your browser settings/)).toBeInTheDocument()
  })

  it('notices when permission is revoked in the browser settings', async () => {
    Object.defineProperty(navigator, 'permissions', {
      value: { query: async () => status },
      configurable: true,
    })
    permission = 'granted'
    render(<NotificationToggle enabled onChange={() => {}} />)
    await act(async () => {})
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')

    permission = 'denied'
    act(() => {
      status.dispatchEvent(new Event('change'))
    })
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/blocked in your browser settings/)).toBeInTheDocument()
  })

  it('catches up when the page is shown again, without the Permissions API', () => {
    permission = 'granted'
    render(<NotificationToggle enabled onChange={() => {}} />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')

    permission = 'denied'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })
})
