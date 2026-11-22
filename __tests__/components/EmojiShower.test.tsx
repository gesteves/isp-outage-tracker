import { act, render, screen } from '@testing-library/react'
import EmojiShower from '@/components/EmojiShower'
import { SHOWER_EMOJI, SHOWER_MAX_MS } from '@/lib/emoji-shower'
import { ConnectionStatus } from '@/lib/monitor'

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia
}

function shownEmoji(): string[] {
  const shower = screen.queryByTestId('emoji-shower')
  return shower ? Array.from(shower.children, el => el.textContent ?? '') : []
}

function renderWith(status: ConnectionStatus) {
  const result = render(<EmojiShower status={status} />)
  return { ...result, change: (next: ConnectionStatus) => result.rerender(<EmojiShower status={next} />) }
}

describe('EmojiShower', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    jest.useFakeTimers()
    mockReducedMotion(false)
  })

  afterEach(() => {
    jest.useRealTimers()
    window.matchMedia = originalMatchMedia
  })

  it('shows nothing on first render', () => {
    renderWith('down')
    expect(screen.queryByTestId('emoji-shower')).not.toBeInTheDocument()
  })

  it('showers outage emoji when the connection goes down', () => {
    const { change } = renderWith('up')
    change('down')
    const emoji = shownEmoji()
    expect(emoji.length).toBeGreaterThan(0)
    emoji.forEach(e => expect(SHOWER_EMOJI.start).toContain(e))
  })

  it('showers celebration emoji when the connection comes back', () => {
    const { change } = renderWith('down')
    change('up')
    const emoji = shownEmoji()
    expect(emoji.length).toBeGreaterThan(0)
    emoji.forEach(e => expect(SHOWER_EMOJI.end).toContain(e))
  })

  it.each([
    ['unknown', 'down'],
    ['unknown', 'up'],
    ['down', 'unknown'],
    ['up', 'unknown'],
  ] as const)('does nothing going from %s to %s', (from, to) => {
    const { change } = renderWith(from)
    change(to)
    expect(screen.queryByTestId('emoji-shower')).not.toBeInTheDocument()
  })

  it('clears the shower once it has finished', () => {
    const { change } = renderWith('up')
    change('down')
    act(() => jest.advanceTimersByTime(SHOWER_MAX_MS - 1))
    expect(screen.getByTestId('emoji-shower')).toBeInTheDocument()
    act(() => jest.advanceTimersByTime(1))
    expect(screen.queryByTestId('emoji-shower')).not.toBeInTheDocument()
  })

  it('replaces a running shower when the status flips again', () => {
    const { change } = renderWith('up')
    change('down')
    act(() => jest.advanceTimersByTime(SHOWER_MAX_MS / 2))
    change('up')
    shownEmoji().forEach(e => expect(SHOWER_EMOJI.end).toContain(e))
    // The new shower gets its full time.
    act(() => jest.advanceTimersByTime(SHOWER_MAX_MS - 1))
    expect(screen.getByTestId('emoji-shower')).toBeInTheDocument()
  })

  it('is hidden from assistive tech and lets clicks through', () => {
    const { change } = renderWith('up')
    change('down')
    const shower = screen.getByTestId('emoji-shower')
    expect(shower).toHaveAttribute('aria-hidden', 'true')
    expect(shower).toHaveClass('pointer-events-none')
  })

  it('does nothing when the system asks for reduced motion', () => {
    mockReducedMotion(true)
    const { change } = renderWith('up')
    change('down')
    expect(screen.queryByTestId('emoji-shower')).not.toBeInTheDocument()
  })
})
