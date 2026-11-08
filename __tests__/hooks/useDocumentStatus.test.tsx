import { renderHook } from '@testing-library/react'
import { statusIconUrl, useDocumentStatus } from '@/hooks/useDocumentStatus'

describe('useDocumentStatus', () => {
  beforeEach(() => {
    // Replacing the head's HTML drops <title>, so set the title afterwards.
    document.head.innerHTML = '<link rel="icon" href="/icon.svg" type="image/svg+xml">'
    document.title = 'ISP Outage Tracker'
  })

  it('puts the status in the title and favicon', () => {
    const { rerender } = renderHook(({ status }) => useDocumentStatus(status), {
      initialProps: { status: 'down' as const },
    })
    expect(document.title).toBe('Down · ISP Outage Tracker')
    expect(document.querySelector('link[rel="icon"]')!.getAttribute('href')).toBe(statusIconUrl('down'))

    rerender({ status: 'up' as never })
    expect(document.title).toBe('Up · ISP Outage Tracker')
    expect(document.querySelector('link[rel="icon"]')!.getAttribute('href')).toBe(statusIconUrl('up'))
  })

  it('restores the original title and icon on unmount', () => {
    const { unmount } = renderHook(() => useDocumentStatus('unknown'))
    expect(document.title).toBe('Checking… · ISP Outage Tracker')
    unmount()
    expect(document.title).toBe('ISP Outage Tracker')
    expect(document.querySelector('link[rel="icon"]')!.getAttribute('href')).toBe('/icon.svg')
  })

  it('adds a favicon link if the page has none, and removes it afterwards', () => {
    document.head.innerHTML = ''
    const { unmount } = renderHook(() => useDocumentStatus('down'))
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1)
    unmount()
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(0)
  })

  it('uses a different icon color per status', () => {
    expect(new Set([statusIconUrl('up'), statusIconUrl('down'), statusIconUrl('unknown')]).size).toBe(3)
  })
})
