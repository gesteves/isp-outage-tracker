import { DEFAULT_OUTAGE_END_EMOJI, DEFAULT_OUTAGE_START_EMOJI, EMOJI_SHOWER_DURATION_MS } from '@/lib/config'
import { SHOWER_EMOJI, SHOWER_PARTICLE_COUNT, createShowerParticles } from '@/lib/emoji-shower'

describe('createShowerParticles', () => {
  it('makes the default number of particles', () => {
    expect(createShowerParticles('start')).toHaveLength(SHOWER_PARTICLE_COUNT)
  })

  it('draws emoji only from the set for the kind of change', () => {
    for (const kind of ['start', 'end'] as const) {
      const particles = createShowerParticles(kind, 200)
      particles.forEach(p => expect(SHOWER_EMOJI[kind]).toContain(p.emoji))
    }
  })

  it('keeps the default start and end sets apart', () => {
    const overlap = DEFAULT_OUTAGE_START_EMOJI.filter(e => DEFAULT_OUTAGE_END_EMOJI.includes(e))
    expect(overlap).toEqual([])
  })

  it('stays within range at the extremes of the random source', () => {
    for (const value of [0, 0.999999]) {
      const [p] = createShowerParticles('end', 1, () => value)
      expect(p.left).toBeGreaterThanOrEqual(0)
      expect(p.left).toBeLessThanOrEqual(100)
      expect(p.sizeRem).toBeGreaterThanOrEqual(1.5)
      expect(p.sizeRem).toBeLessThanOrEqual(3)
      expect(Math.abs(p.drift)).toBeLessThanOrEqual(40)
      expect(Math.abs(p.spin)).toBeLessThanOrEqual(360)
      expect(SHOWER_EMOJI.end).toContain(p.emoji)
    }
  })

  it.each([undefined, 100, 1000, 7000])('has every emoji land within the shower (total %p ms)', totalMs => {
    const total = totalMs ?? EMOJI_SHOWER_DURATION_MS
    for (const value of [0, 0.999999]) {
      const [p] = createShowerParticles('start', 1, () => value, totalMs)
      expect(p.delayMs).toBeGreaterThanOrEqual(0)
      expect(p.durationMs).toBeGreaterThan(0)
      expect(p.delayMs + p.durationMs).toBeLessThanOrEqual(total)
    }
  })

  it('gives each particle its own id', () => {
    const ids = createShowerParticles('start').map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
