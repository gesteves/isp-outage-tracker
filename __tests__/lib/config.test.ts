import { parseEmojiList, parsePositiveInt } from '@/lib/config'

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

describe('parseEmojiList', () => {
  const fallback = ['🙂']

  it('reads emoji separated by spaces or commas', () => {
    expect(parseEmojiList('😩 🤬, 😱', fallback)).toEqual(['😩', '🤬', '😱'])
  })

  it('reads emoji written together', () => {
    expect(parseEmojiList('😩🤬😱', fallback)).toEqual(['😩', '🤬', '😱'])
  })

  it('keeps emoji made of several code points whole', () => {
    expect(parseEmojiList('😵‍💫🎉', fallback)).toEqual(['😵‍💫', '🎉'])
    expect(parseEmojiList('👍🏽 🇦🇷', fallback)).toEqual(['👍🏽', '🇦🇷'])
  })

  it('keeps duplicates', () => {
    expect(parseEmojiList('💀💀🎉', fallback)).toEqual(['💀', '💀', '🎉'])
  })

  it('uses the fallback when there are no emoji', () => {
    for (const raw of [undefined, '', '  ', ', ,']) {
      expect(parseEmojiList(raw, fallback)).toBe(fallback)
    }
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
    process.env.NEXT_PUBLIC_EMOJI_SHOWER_DURATION_MS = 'oops'
    process.env.NEXT_PUBLIC_EMOJI_SHOWER_FALL_MS = 'oops'
    process.env.NEXT_PUBLIC_EMOJI_SHOWER_PER_SECOND = '1.5'
    process.env.NEXT_PUBLIC_OUTAGE_START_EMOJI = ' , '
    process.env.NEXT_PUBLIC_OUTAGE_END_EMOJI = ''
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const config = require('@/lib/config')
      expect(config.CHECK_INTERVAL_MS).toBe(60_000)
      expect(config.FAILURE_THRESHOLD).toBe(2)
      expect(config.EMOJI_SHOWER_DURATION_MS).toBe(config.DEFAULT_EMOJI_SHOWER_DURATION_MS)
      expect(config.EMOJI_SHOWER_FALL_MS).toBe(config.DEFAULT_EMOJI_SHOWER_FALL_MS)
      expect(config.EMOJI_SHOWER_PER_SECOND).toBe(config.DEFAULT_EMOJI_SHOWER_PER_SECOND)
      expect(config.OUTAGE_START_EMOJI).toBe(config.DEFAULT_OUTAGE_START_EMOJI)
      expect(config.OUTAGE_END_EMOJI).toBe(config.DEFAULT_OUTAGE_END_EMOJI)
    })
  })

  it('uses the default shower timings when the values are below the minimum', () => {
    process.env.NEXT_PUBLIC_EMOJI_SHOWER_DURATION_MS = '50'
    process.env.NEXT_PUBLIC_EMOJI_SHOWER_FALL_MS = '50'
    process.env.NEXT_PUBLIC_EMOJI_SHOWER_PER_SECOND = '0'
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const config = require('@/lib/config')
      expect(config.EMOJI_SHOWER_DURATION_MS).toBe(config.DEFAULT_EMOJI_SHOWER_DURATION_MS)
      expect(config.EMOJI_SHOWER_FALL_MS).toBe(config.DEFAULT_EMOJI_SHOWER_FALL_MS)
      expect(config.EMOJI_SHOWER_PER_SECOND).toBe(config.DEFAULT_EMOJI_SHOWER_PER_SECOND)
    })
  })

  it('reads valid env vars', () => {
    process.env.NEXT_PUBLIC_CHECK_INTERVAL_SECONDS = '15'
    process.env.NEXT_PUBLIC_FAILURE_THRESHOLD = '3'
    process.env.NEXT_PUBLIC_EMOJI_SHOWER_DURATION_MS = '1500'
    process.env.NEXT_PUBLIC_EMOJI_SHOWER_FALL_MS = '3500'
    process.env.NEXT_PUBLIC_EMOJI_SHOWER_PER_SECOND = '30'
    process.env.NEXT_PUBLIC_OUTAGE_START_EMOJI = '🔥 🚨'
    process.env.NEXT_PUBLIC_OUTAGE_END_EMOJI = '🎉'
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const config = require('@/lib/config')
      expect(config.CHECK_INTERVAL_MS).toBe(15_000)
      expect(config.FAILURE_THRESHOLD).toBe(3)
      expect(config.EMOJI_SHOWER_DURATION_MS).toBe(1500)
      expect(config.EMOJI_SHOWER_FALL_MS).toBe(3500)
      expect(config.EMOJI_SHOWER_PER_SECOND).toBe(30)
      expect(config.OUTAGE_START_EMOJI).toEqual(['🔥', '🚨'])
      expect(config.OUTAGE_END_EMOJI).toEqual(['🎉'])
    })
  })
})
