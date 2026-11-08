import { formatDurationFromSeconds, formatPercentage, formatTimeAgo } from '@/lib/format'

describe('formatDurationFromSeconds', () => {
  it('should format 0 seconds', () => {
    expect(formatDurationFromSeconds(0)).toBe('0s')
  })

  it('should format seconds only', () => {
    expect(formatDurationFromSeconds(45)).toBe('45s')
  })

  it('should format minutes and seconds', () => {
    expect(formatDurationFromSeconds(90)).toBe('1m 30s')
  })

  it('should format hours, minutes, and seconds', () => {
    expect(formatDurationFromSeconds(3665)).toBe('1h 1m 5s')
  })

  it('should format hours and minutes without seconds', () => {
    expect(formatDurationFromSeconds(3660)).toBe('1h 1m')
  })

  it('should keep counting days past a month', () => {
    expect(formatDurationFromSeconds(31 * 86400 + 5)).toBe('31d 5s')
    expect(formatDurationFromSeconds(45 * 86400)).toBe('45d')
    expect(formatDurationFromSeconds(400 * 86400 + 3600)).toBe('400d 1h')
  })

  it('should drop fractional seconds and clamp negatives', () => {
    expect(formatDurationFromSeconds(90.9)).toBe('1m 30s')
    expect(formatDurationFromSeconds(0.4)).toBe('0s')
    expect(formatDurationFromSeconds(-5)).toBe('0s')
  })
})

describe('formatPercentage', () => {
  it('should round down so any downtime stays below 100%', () => {
    expect(formatPercentage(99.996)).toBe('99.99')
    expect(formatPercentage(100)).toBe('100.00')
  })

  it('should not lose a hundredth to floating point error', () => {
    expect(formatPercentage(0.29)).toBe('0.29')
    expect(formatPercentage(1.13)).toBe('1.13')
    expect(formatPercentage(95.83)).toBe('95.83')
  })
})

describe('formatTimeAgo', () => {
  const now = Date.parse('2024-06-15T12:00:00Z')
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

  it('uses the largest whole unit', () => {
    expect(formatTimeAgo(ago(30), now, 'en')).toBe('30 seconds ago')
    expect(formatTimeAgo(ago(5 * 60), now, 'en')).toBe('5 minutes ago')
    expect(formatTimeAgo(ago(3 * 3600), now, 'en')).toBe('3 hours ago')
    expect(formatTimeAgo(ago(3 * 86400), now, 'en')).toBe('3 days ago')
    expect(formatTimeAgo(ago(14 * 86400), now, 'en')).toBe('2 weeks ago')
    expect(formatTimeAgo(ago(400 * 86400), now, 'en')).toBe('last year')
  })

  it('truncates instead of rounding up', () => {
    expect(formatTimeAgo(ago(90 * 60), now, 'en')).toBe('1 hour ago')
  })

  it('uses natural phrasing where the locale has it', () => {
    expect(formatTimeAgo(ago(0), now, 'en')).toBe('now')
    expect(formatTimeAgo(ago(86400), now, 'en')).toBe('yesterday')
  })

  it('handles future times', () => {
    expect(formatTimeAgo(ago(-2 * 3600), now, 'en')).toBe('in 2 hours')
  })
})

describe('formatDurationFromSeconds maxParts', () => {
  it('keeps only the largest units', () => {
    expect(formatDurationFromSeconds(20 * 86400 + 22 * 3600 + 6, { maxParts: 2 })).toBe('20d 22h')
    expect(formatDurationFromSeconds(30 * 86400 + 7, { maxParts: 2 })).toBe('30d')
    expect(formatDurationFromSeconds(3600 + 5 * 60 + 9, { maxParts: 2 })).toBe('1h 5m')
    expect(formatDurationFromSeconds(3600 + 9, { maxParts: 2 })).toBe('1h')
    expect(formatDurationFromSeconds(45, { maxParts: 2 })).toBe('45s')
    expect(formatDurationFromSeconds(0, { maxParts: 2 })).toBe('0s')
  })
})
