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

  it('keeps the start and end sets apart', () => {
    const overlap = SHOWER_EMOJI.start.filter(e => SHOWER_EMOJI.end.includes(e))
    expect(overlap).toEqual([])
  })

  it('stays within range at the extremes of the random source', () => {
    for (const value of [0, 0.999999]) {
      const [p] = createShowerParticles('end', 1, () => value)
      expect(p.left).toBeGreaterThanOrEqual(0)
      expect(p.left).toBeLessThanOrEqual(100)
      expect(p.delayMs).toBeGreaterThanOrEqual(0)
      expect(p.delayMs).toBeLessThanOrEqual(1200)
      expect(p.durationMs).toBeGreaterThanOrEqual(2500)
      expect(p.durationMs).toBeLessThanOrEqual(4000)
      expect(p.sizeRem).toBeGreaterThanOrEqual(1.5)
      expect(p.sizeRem).toBeLessThanOrEqual(3)
      expect(Math.abs(p.drift)).toBeLessThanOrEqual(40)
      expect(Math.abs(p.spin)).toBeLessThanOrEqual(360)
      expect(SHOWER_EMOJI.end).toContain(p.emoji)
    }
  })

  it('gives each particle its own id', () => {
    const ids = createShowerParticles('start').map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
