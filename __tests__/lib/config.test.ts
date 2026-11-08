import { parsePositiveInt } from '@/lib/config'

describe('parsePositiveInt', () => {
  it('uses the fallback when the value is missing or blank', () => {
    expect(parsePositiveInt(undefined, 60, 5)).toBe(60)
    expect(parsePositiveInt('', 60, 5)).toBe(60)
    expect(parsePositiveInt('  ', 60, 5)).toBe(60)
  })

  it('parses valid integers', () => {
    expect(parsePositiveInt('30', 60, 5)).toBe(30)
    expect(parsePositiveInt(' 10 ', 60, 5)).toBe(10)
    expect(parsePositiveInt('1', 2, 1)).toBe(1)
  })

  it('falls back on malformed values instead of producing NaN', () => {
    expect(parsePositiveInt('abc', 60, 5)).toBe(60)
    expect(parsePositiveInt('60s', 60, 5)).toBe(60)
    expect(parsePositiveInt('1.5', 2, 1)).toBe(2)
  })

  it('falls back on values below the minimum', () => {
    expect(parsePositiveInt('0', 60, 5)).toBe(60)
    expect(parsePositiveInt('-10', 60, 5)).toBe(60)
    expect(parsePositiveInt('4', 60, 5)).toBe(60)
    expect(parsePositiveInt('0', 2, 1)).toBe(2)
  })
})

describe('config from env', () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
    jest.resetModules()
  })

  it('uses defaults when env vars are invalid', () => {
    process.env.NEXT_PUBLIC_CHECK_INTERVAL_SECONDS = 'oops'
    process.env.NEXT_PUBLIC_FAILURE_THRESHOLD = '0'
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const config = require('@/lib/config')
      expect(config.CHECK_INTERVAL_MS).toBe(60_000)
      expect(config.FAILURE_THRESHOLD).toBe(2)
    })
  })

  it('reads valid env vars', () => {
    process.env.NEXT_PUBLIC_CHECK_INTERVAL_SECONDS = '15'
    process.env.NEXT_PUBLIC_FAILURE_THRESHOLD = '3'
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const config = require('@/lib/config')
      expect(config.CHECK_INTERVAL_MS).toBe(15_000)
      expect(config.FAILURE_THRESHOLD).toBe(3)
    })
  })
})
