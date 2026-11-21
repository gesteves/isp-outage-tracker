import { INCIDENT_MERGE_GAP_MS, groupIncidents, incidentNumbers } from '@/lib/incidents'
import { Outage } from '@/types'

const T0 = Date.parse('2024-01-01T10:00:00Z')
const MIN = 60_000

function outage(id: string, startMin: number, lengthMin: number | null, extra: Partial<Outage> = {}): Outage {
  const start = T0 + startMin * MIN
  return {
    id,
    startTime: new Date(start).toISOString(),
    endTime: lengthMin === null ? null : new Date(start + lengthMin * MIN).toISOString(),
    duration: lengthMin === null ? null : lengthMin * 60,
    cause: 'isp',
    ...extra,
  }
}

describe('groupIncidents', () => {
  it('groups ISP outages less than the merge gap apart, oldest first', () => {
    const incidents = groupIncidents([
      outage('c', 60, 5),
      outage('a', 0, 2),
      outage('b', 2 + INCIDENT_MERGE_GAP_MS / MIN, 1), // exactly the gap after a ends
    ])
    expect(incidents).toHaveLength(2)
    expect(incidents[0]).toMatchObject({
      number: 1,
      start: T0,
      end: T0 + 13 * MIN,
      outageIds: ['a', 'b'],
      downtimeSeconds: 3 * 60,
      spanSeconds: 13 * 60,
      ongoing: false,
    })
    expect(incidents[1]).toMatchObject({ number: 2, outageIds: ['c'] })
  })

  it('leaves out local and flagged outages, which neither join nor bridge incidents', () => {
    const incidents = groupIncidents([
      outage('a', 0, 1),
      outage('local', 8, 5, { cause: 'local' }),
      outage('flagged', 15, 5, { flagged: true }),
      outage('b', 18, 1),
    ])
    expect(incidents.map(i => i.outageIds)).toEqual([['a'], ['b']])
  })

  it('counts an ongoing outage up to the edge', () => {
    const [incident] = groupIncidents([outage('a', 0, 2), outage('b', 5, null)], { edge: T0 + 20 * MIN })
    expect(incident).toMatchObject({ ongoing: true, end: T0 + 20 * MIN, downtimeSeconds: 17 * 60, spanSeconds: 20 * 60 })
  })

  it('maps outages to their incident numbers', () => {
    const numbers = incidentNumbers(groupIncidents([outage('a', 0, 1), outage('b', 3, 1), outage('c', 60, 1)]))
    expect(Object.fromEntries(numbers)).toEqual({ a: 1, b: 1, c: 2 })
  })
})
