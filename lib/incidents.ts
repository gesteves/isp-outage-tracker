import { Outage } from '@/types';

/** ISP outages less than this far apart are grouped into one incident. */
export const INCIDENT_MERGE_GAP_MS = 10 * 60_000;

/**
 * A run of ISP outages close together: a flapping connection logs several outages
 * with a minute or two of connection in between, but it's one problem.
 */
export interface Incident {
  /** 1 for the oldest incident. */
  number: number;
  /** Start of its first outage and end of its last (epoch ms). */
  start: number;
  end: number;
  /** Its outages, oldest first. */
  outageIds: string[];
  /** Total downtime of its outages (seconds). Less than its span when the connection came back in between. */
  downtimeSeconds: number;
  /** From start to end (seconds). */
  spanSeconds: number;
  /** True if its last outage is still going on. */
  ongoing: boolean;
}

/** Whether an outage counts toward incidents: ISP outages the user didn't flag. */
export function countsTowardIncidents(outage: Outage): boolean {
  return outage.cause !== 'local' && !outage.flagged;
}

/**
 * Groups ISP outages into incidents. Local and flagged outages are left out. `edge`
 * is where an ongoing outage counts up to (e.g. now); without it, it ends where it started.
 */
export function groupIncidents(
  outages: Outage[],
  { mergeGapMs = INCIDENT_MERGE_GAP_MS, edge }: { mergeGapMs?: number; edge?: number } = {},
): Incident[] {
  const sorted = outages
    .filter(countsTowardIncidents)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

  const incidents: Incident[] = [];
  for (const outage of sorted) {
    const start = Date.parse(outage.startTime);
    const ongoing = outage.endTime === null;
    const end = ongoing ? Math.max(start, edge ?? start) : Date.parse(outage.endTime!);
    const seconds = ongoing ? (end - start) / 1000 : (outage.duration ?? (end - start) / 1000);

    const last = incidents[incidents.length - 1];
    if (last && start - last.end <= mergeGapMs) {
      last.end = Math.max(last.end, end);
      last.outageIds.push(outage.id);
      last.downtimeSeconds += seconds;
      last.spanSeconds = (last.end - last.start) / 1000;
      last.ongoing = ongoing;
    } else {
      incidents.push({
        number: incidents.length + 1,
        start,
        end,
        outageIds: [outage.id],
        downtimeSeconds: seconds,
        spanSeconds: (end - start) / 1000,
        ongoing,
      });
    }
  }
  return incidents;
}

/** Incident number of each outage that's in one, by outage id. */
export function incidentNumbers(incidents: Incident[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const incident of incidents) {
    for (const id of incident.outageIds) numbers.set(id, incident.number);
  }
  return numbers;
}
