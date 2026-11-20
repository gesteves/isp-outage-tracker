import { fromDateTimeLocal, sortAnnotations, toDateTimeLocal, upsertAnnotation } from '@/lib/annotations'

describe('annotations', () => {
  it('round-trips datetime-local values in local time', () => {
    const ms = new Date(2026, 10, 20, 12, 5).getTime()
    expect(toDateTimeLocal(ms)).toBe('2026-11-20T12:05')
    expect(fromDateTimeLocal('2026-11-20T12:05')).toBe(ms)
    expect(fromDateTimeLocal('2026-11-20T12:05:30')).toBe(ms + 30_000)
  })

  it('rejects values that are not datetime-local', () => {
    expect(fromDateTimeLocal('')).toBeNull()
    expect(fromDateTimeLocal('yesterday')).toBeNull()
  })

  it('keeps notes oldest first, replacing by id', () => {
    const a = { id: 'a', time: '2024-01-02T00:00:00.000Z', text: 'A' }
    const b = { id: 'b', time: '2024-01-01T00:00:00.000Z', text: 'B' }
    expect(sortAnnotations([a, b]).map(n => n.id)).toEqual(['b', 'a'])
    const moved = { ...a, time: '2023-12-31T00:00:00.000Z', text: 'A2' }
    expect(upsertAnnotation([b, a], moved)).toEqual([moved, b])
  })
})
