import { Outage, OutageStats } from '@/types';
import { gapThresholdMs } from '@/lib/monitor';

export interface StatsInput {
  outages: Outage[];
  trackingStartTime: string | null;
  lastCheckAt: number | null;
  monitoredByDay: Record<string, number>;
  legacyMonitoredMs: number;
}

export interface DayStats {
  /** Local date, 'YYYY-MM-DD'. */
  day: string;
  /** Local midnight that starts the day (epoch ms). */
  start: number;
  ispSeconds: number;
  localSeconds: number;
  /** Outages that started this day. */
  outages: number;
  monitoredSeconds: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day of a timestamp, as 'YYYY-MM-DD'. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local midnight after `ms`. DST-safe: those days are 23 or 25 hours long. */
export function startOfNextDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calls fn(dayStart, overlapMs) for each local day that [fromMs, toMs) touches. */
function forEachDay(fromMs: number, toMs: number, fn: (dayStart: number, ms: number) => void): void {
  let cursor = fromMs;
  while (cursor < toMs) {
    const next = Math.min(toMs, startOfNextDay(cursor));
    fn(startOfDay(cursor), next - cursor);
    cursor = next;
  }
}

/** Adds the span [fromMs, toMs) to the per-day monitored totals, split at local midnight. */
export function accrueMonitoredTime(
  byDay: Record<string, number>,
  fromMs: number,
  toMs: number,
): Record<string, number> {
  const result = { ...byDay };
  forEachDay(fromMs, toMs, (dayStart, ms) => {
    const key = dayKey(dayStart);
    result[key] = (result[key] ?? 0) + ms;
  });
  return result;
}

/**
 * The live edge of monitoring: now, but never more than the gap threshold past the
 * last check. If checking stopped, ongoing numbers stop growing there.
 */
function liveEdge(lastCheckAt: number | null, now: number, intervalMs: number): number {
  if (lastCheckAt === null) return now;
  return Math.max(lastCheckAt, Math.min(now, lastCheckAt + gapThresholdMs(intervalMs)));
}

function outageEnd(outage: Outage, edge: number): number {
  return outage.endTime ? Date.parse(outage.endTime) : edge;
}

function outageSeconds(outage: Outage, edge: number): number {
  if (outage.duration !== null) return outage.duration;
  return Math.max(0, (edge - Date.parse(outage.startTime)) / 1000);
}

export function calculateStats(input: StatsInput, now: number, intervalMs: number): OutageStats {
  const { outages, trackingStartTime, lastCheckAt, monitoredByDay, legacyMonitoredMs } = input;
  if (!trackingStartTime) {
    return {
      trackingStartTime: null,
      trackedSeconds: 0,
      monitoredSeconds: 0,
      ispOutages: 0,
      ispDowntime: 0,
      localOutages: 0,
      localDowntime: 0,
      uptimePercentage: 100,
    };
  }

  const edge = liveEdge(lastCheckAt, now, intervalMs);
  const recordedMs = Object.values(monitoredByDay).reduce((sum, ms) => sum + ms, 0);
  const liveTailMs = lastCheckAt !== null ? edge - lastCheckAt : 0;
  const monitoredSeconds = (legacyMonitoredMs + recordedMs + liveTailMs) / 1000;

  let ispOutages = 0;
  let ispDowntime = 0;
  let localOutages = 0;
  let localDowntime = 0;
  for (const outage of outages) {
    const seconds = outageSeconds(outage, edge);
    if (outage.cause === 'local') {
      localOutages += 1;
      localDowntime += seconds;
    } else {
      ispOutages += 1;
      ispDowntime += seconds;
    }
  }

  // Time the device had no network says nothing about the ISP, so it's left out entirely.
  const observableSeconds = monitoredSeconds - localDowntime;
  const uptimePercentage = observableSeconds > 0
    ? ((observableSeconds - ispDowntime) / observableSeconds) * 100
    : 100;

  return {
    trackingStartTime,
    trackedSeconds: Math.max(0, (now - Date.parse(trackingStartTime)) / 1000),
    monitoredSeconds,
    ispOutages,
    ispDowntime,
    localOutages,
    localDowntime,
    uptimePercentage: Math.max(0, Math.min(100, uptimePercentage)),
  };
}

/** Per-day downtime and monitoring for the last `days` local days, oldest first, ending today. */
export function dailyBreakdown(
  input: StatsInput,
  now: number,
  intervalMs: number,
  days = 30,
): DayStats[] {
  const { outages, lastCheckAt, monitoredByDay } = input;
  const edge = liveEdge(lastCheckAt, now, intervalMs);

  const result: DayStats[] = [];
  const byKey = new Map<string, DayStats>();
  const cursor = new Date(startOfDay(now));
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const start = cursor.getTime();
    const stats: DayStats = {
      day: dayKey(start),
      start,
      ispSeconds: 0,
      localSeconds: 0,
      outages: 0,
      monitoredSeconds: (monitoredByDay[dayKey(start)] ?? 0) / 1000,
    };
    result.push(stats);
    byKey.set(stats.day, stats);
    cursor.setDate(cursor.getDate() + 1);
  }

  // The time since the last check hasn't been recorded yet, but it's being monitored.
  if (lastCheckAt !== null) {
    forEachDay(lastCheckAt, edge, (dayStart, ms) => {
      const stats = byKey.get(dayKey(dayStart));
      if (stats) stats.monitoredSeconds += ms / 1000;
    });
  }

  for (const outage of outages) {
    const startMs = Date.parse(outage.startTime);
    const started = byKey.get(dayKey(startMs));
    if (started) started.outages += 1;
    forEachDay(startMs, outageEnd(outage, edge), (dayStart, ms) => {
      const stats = byKey.get(dayKey(dayStart));
      if (!stats) return;
      if (outage.cause === 'local') stats.localSeconds += ms / 1000;
      else stats.ispSeconds += ms / 1000;
    });
  }

  return result;
}
