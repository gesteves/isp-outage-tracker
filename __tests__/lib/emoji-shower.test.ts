import {
  DEFAULT_OUTAGE_END_EMOJI,
  DEFAULT_OUTAGE_START_EMOJI,
  EMOJI_SHOWER_DURATION_MS,
  EMOJI_SHOWER_FALL_MS,
  EMOJI_SHOWER_PER_SECOND,
} from '@/lib/config'
import {
  SHOWER_EMOJI,
  createShowerParticles,
  showerLifetimeMs,
  showerParticleCount,
} from '@/lib/emoji-shower'

const TOTALS = [undefined, 100, 1000, 7000]

describe('showerParticleCount', () => {
  it.each(TOTALS)('starts emoji at a steady rate (total %p ms)', totalMs => {
    const total = totalMs ?? EMOJI_SHOWER_DURATION_MS
    expect(showerParticleCount(totalMs)).toBe(Math.max(1, Math.round((EMOJI_SHOWER_PER_SECOND * total) / 1000)))
  })

  it('drops more emoji in a longer shower', () => {
    expect(showerParticleCount(7000)).toBeGreaterThan(showerParticleCount(1000))
  })

  it('always drops at least one emoji', () => {
    expect(showerParticleCount(0)).toBe(1)
  })
})

describe('showerLifetimeMs', () => {
  it.each(TOTALS)('leaves time for the last emoji to land (total %p ms)', totalMs => {
    const total = totalMs ?? EMOJI_SHOWER_DURATION_MS
    expect(showerLifetimeMs(totalMs)).toBe(total + EMOJI_SHOWER_FALL_MS)
  })
})

describe('createShowerParticles', () => {
  it.each(TOTALS)('makes as many particles as the duration calls for (total %p ms)', totalMs => {
    expect(createShowerParticles('start', totalMs)).toHaveLength(showerParticleCount(totalMs))
  })

  it.each(TOTALS)('spreads start times evenly across the duration (total %p ms)', totalMs => {
    const total = totalMs ?? EMOJI_SHOWER_DURATION_MS
    for (const value of [0, 0.999999]) {
      const particles = createShowerParticles('start', totalMs, () => value)
      const slot = total / particles.length
      particles.forEach((p, i) => {
        expect(p.delayMs).toBeGreaterThanOrEqual(i * slot)
        expect(p.delayMs).toBeLessThan((i + 1) * slot)
      })
    }
  })

  it('draws emoji only from the set for the kind of change', () => {
    for (const kind of ['start', 'end'] as const) {
      const particles = createShowerParticles(kind, 15_000)
      particles.forEach(p => expect(SHOWER_EMOJI[kind]).toContain(p.emoji))
    }
  })

  it('keeps the default start and end sets apart', () => {
    const overlap = DEFAULT_OUTAGE_START_EMOJI.filter(e => DEFAULT_OUTAGE_END_EMOJI.includes(e))
    expect(overlap).toEqual([])
  })

  it('stays within range at the extremes of the random source', () => {
    for (const value of [0, 0.999999]) {
      for (const p of createShowerParticles('end', undefined, () => value)) {
        expect(p.left).toBeGreaterThanOrEqual(0)
        expect(p.left).toBeLessThanOrEqual(100)
        expect(p.sizeRem).toBeGreaterThanOrEqual(1.5)
        expect(p.sizeRem).toBeLessThanOrEqual(3)
        expect(Math.abs(p.drift)).toBeLessThanOrEqual(40)
        expect(Math.abs(p.spin)).toBeLessThanOrEqual(360)
        expect(SHOWER_EMOJI.end).toContain(p.emoji)
      }
    }
  })

  it('gives each particle its own id', () => {
    const ids = createShowerParticles('start').map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
