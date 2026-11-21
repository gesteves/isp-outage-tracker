import { Annotation, DayStats, Outage } from '@/types';
import { CHECK_TIMEOUT_MS } from '@/lib/connectivity';
import { buildCsv, localTimeZone } from '@/lib/csv';
import { downloadFile } from '@/lib/download';
import { formatLocalIso, formatPercentage } from '@/lib/format';
import { INCIDENT_MERGE_GAP_MS, Incident, countsTowardIncidents, groupIncidents } from '@/lib/incidents';
import { FAST_RETRY_MS, RECOVERY_WATCH_MS, SETTLED_SAMPLE_COUNT } from '@/lib/monitor';
import { sortAnnotations } from '@/lib/annotations';
import {
  StatsInput,
  calculateStats,
  dailyBreakdown,
  dayKey,
  forEachHour,
  hourKeyStart,
  liveEdge,
  startOfNextDay,
  windowUptime,
} from '@/lib/stats';

/** Most days the daily coverage table lists, so years of history don't make an unwieldy file. */
export const MAX_COVERAGE_DAYS = 366;

/** Most incidents the incidents table lists (the most recent ones). */
export const MAX_INCIDENT_ROWS = 200;

/** Duration buckets for the distribution table: label and upper bound (seconds, exclusive). */
export const DURATION_BUCKETS: Array<[string, number]> = [
  ['Under 1 minute', 60],
  ['1–5 minutes', 5 * 60],
  ['5–15 minutes', 15 * 60],
  ['15–60 minutes', 60 * 60],
  ['1–4 hours', 4 * 3600],
  ['4 hours or more', Infinity],
];

const HOUR_MS = 3600 * 1000;

export interface ReportInput extends StatsInput {
  annotations: Annotation[];
}

export interface ReportOptions {
  now: number;
  intervalMs: number;
  failureThreshold: number;
  timeZone?: string;
  /** The ISP detected most recently, if known. */
  ispName?: string | null;
}

const hours = (seconds: number) => (seconds / 3600).toFixed(1);
const minutes = (seconds: number) => (seconds / 60).toFixed(1);
const uptime = (value: number | null) => (value === null ? 'n/a (not monitored)' : `${formatPercentage(value)}%`);
const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

function table(headers: string[], rows: string[][]): string {
  return [headers, headers.map(() => '---'), ...rows].map(row => `| ${row.join(' | ')} |`).join('\n');
}

/** Free text made safe for a table cell: one line, no column breaks, not too long. */
function cellText(value: string, max = 80): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  const short = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  return short.replace(/\|/g, '\\|');
}

/** Local days from the one tracking started on through today, inclusive. DST-safe. */
function daysSince(startMs: number, now: number): number {
  const today = dayKey(now);
  let count = 1;
  for (let day = startMs; dayKey(day) !== today && day < now; day = startOfNextDay(day)) count++;
  return count;
}

/** A code fence longer than any run of backticks in `body`, so free-text notes can't close it early. */
function fenceFor(body: string): string {
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map(run => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** Milliseconds [a1, a2) and [b1, b2) have in common. */
function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/** An outage's start and end (epoch ms); an ongoing one runs to `edge`. */
function span(outage: Outage, edge: number): [number, number] {
  const start = Date.parse(outage.startTime);
  return [start, outage.endTime ? Date.parse(outage.endTime) : Math.max(start, edge)];
}

function outageSeconds(outage: Outage, edge: number): number {
  if (outage.duration !== null) return outage.duration;
  const [start, end] = span(outage, edge);
  return (end - start) / 1000;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function windowRow(label: string, days: DayStats[]): string[] {
  const sum = (key: 'monitoredSeconds' | 'ispSeconds' | 'localSeconds' | 'outages') =>
    days.reduce((total, day) => total + day[key], 0);
  return [
    label,
    hours(sum('monitoredSeconds')),
    String(sum('outages')),
    minutes(sum('ispSeconds')),
    minutes(sum('localSeconds')),
    uptime(windowUptime(days, days.length)),
  ];
}

function definitions(intervalMs: number, failureThreshold: number): string {
  const interval = Math.round(intervalMs / 1000);
  const retry = Math.round(Math.min(FAST_RETRY_MS, intervalMs) / 1000);
  const watch = Math.round(RECOVERY_WATCH_MS / 60_000);
  const missable = interval + (failureThreshold - 1) * retry;
  const oldRetry = retry + Math.round(CHECK_TIMEOUT_MS / 1000);
  return [
    `- **Monitoring coverage.** The app only sees outages while it's open in a browser tab. Time it wasn't running (device asleep, tab closed) counts as neither uptime nor downtime. Use the daily coverage table to tell "no outages" apart from "not monitored", and don't measure uptime against calendar time.`,
    `- **Checks.** Every ${interval} seconds the app requests cloudflare.com and google.com (which need DNS) and 1.1.1.1 and 8.8.8.8 (which don't). A check fails when neither named site answers. While a check is failing, and for ${watch} minutes after an outage ends, checks run every ${retry} seconds instead.`,
    `- **Outages.** Logged after ${failureThreshold} failed checks in a row. Start is the first failed check, but the outage began somewhere between the last good check before it (the "Last good check before" column) and then: up to ${interval} seconds earlier. End is the check that saw the connection come back, within about ${retry} seconds of the real end. A drop shorter than about ${missable} seconds can go unnoticed. Outages recorded by earlier versions of the app (blank "Last good check before" and settled response time) were re-checked about every ${oldRetry} seconds, so their ends are accurate to about that.`,
    `- **Incidents.** ISP outages less than ${Math.round(INCIDENT_MERGE_GAP_MS / 60_000)} minutes apart are grouped into one incident (the CSV's Incident column numbers them, oldest first). A flapping connection logs several outages with a minute or two of connection in between, but it's one problem. Local and flagged outages aren't in incidents.`,
    '- **Cause.** `ISP`: the internet was unreachable while the device had a network. `Local network`: every failed check happened while the device reported no network at all (Wi-Fi off, cable unplugged). Local outages are on the user\'s side and are left out of ISP uptime and downtime. The app can\'t tell a dead router or modem, or a power cut while the device runs on battery, from an ISP failure: those count as `ISP`.',
    '- **Failure type.** `DNS only`: the named sites failed but an IP address still answered. `All targets`: nothing answered. `Mixed`: both kinds of failure happened during the outage.',
    '- **Ended by.** `Connection restored`: a check saw the connection come back. `Monitoring stopped`: the app stopped checking during the outage, so it was closed at the last check that saw the connection down. Its real end is unknown and its duration is a lower bound.',
    '- **Flagged.** `Not an outage`: the user marked it as a false alarm. It\'s left out of every figure in this file.',
    '- **Ongoing.** An outage whose End is `Ongoing` was still in progress when this file was exported. The figures count it up to the export time.',
    '- **ISP, public IPs and ASN.** The public IPv4 and IPv6 addresses are looked up separately, so compare each with the same kind. A blank IPv6 can mean the connection has no IPv6. The "before" values come from the last lookup before the outage and can be up to an hour old. The "after" values are looked up right after the connection came back, trying again for up to a minute if that fails. A change suggests a modem restart, a reassigned address or a failover link. Older records have a single address, of either family, shown in its family\'s column.',
    `- **Response times.** "Before": the median of the last few successful checks before the first failed one. "After": the check that saw the connection come back. It often sets up DNS, TCP and TLS from scratch, so it runs high. "After, settled": the median of the ${SETTLED_SAMPLE_COUNT} successful checks after that one; compare this one with "before".`,
    '- **Since previous outage.** Seconds from the end of the previous outage (of any cause, flagged or not) to the start of this one.',
    '- **Notes.** Rows with Type `Note` were written by the user, e.g. "new router". Their Start is when the noted event happened. They don\'t affect any figure, but may explain outages around them. "Before and after notes" compares the periods they divide the history into.',
    '- **ISP uptime** = (monitored time − local downtime − ISP downtime) ÷ (monitored time − local downtime). It\'s shown rounded down to 2 decimals, so any downtime keeps it below 100.00%.',
    '- **Times.** Local times carry their UTC offset; UTC times end in `Z`. Days in the tables are local calendar days.',
    "- **Spreadsheet escapes.** A CSV cell that starts with `'` followed by `=`, `+`, `-` or `@` had the apostrophe added so spreadsheets don't run it as a formula. Ignore the apostrophe.",
  ].join('\n');
}

/** Facts about ISP outages for the summary: counts, typical duration, time between them. */
function outageFacts(ispOutages: Outage[], incidents: Incident[], edge: number, ispUptimeSeconds: number): string[] {
  if (ispOutages.length === 0) return [];
  const durations = ispOutages.map(o => outageSeconds(o, edge));
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  return [
    `- ISP outages: ${ispOutages.length} in ${plural(incidents.length, 'incident')}. Duration: median ${minutes(median(durations))} minutes, mean ${minutes(mean)}, longest ${minutes(Math.max(...durations))}.`,
    `- Mean time between ISP outages: ${hours(ispUptimeSeconds / ispOutages.length)} hours of ISP uptime per outage.`,
  ];
}

function incidentsSection(incidents: Incident[]): string[] {
  if (incidents.length === 0) return [];
  const shown = incidents.slice(-MAX_INCIDENT_ROWS);
  const intro = [
    `ISP outages less than ${Math.round(INCIDENT_MERGE_GAP_MS / 60_000)} minutes apart, grouped, oldest first. Span runs from the start of the first outage to the end of the last; downtime is only the time the outages lasted.`,
  ];
  if (shown.length < incidents.length) intro.push(`Only the last ${shown.length} of ${incidents.length} incidents are listed.`);
  return [
    '## Incidents',
    intro.join(' '),
    table(
      ['Incident', 'Start (local)', 'End (local)', 'Span (minutes)', 'Outages', 'ISP downtime (minutes)'],
      shown.map(incident => [
        String(incident.number),
        formatLocalIso(incident.start),
        incident.ongoing ? 'Ongoing' : formatLocalIso(incident.end),
        minutes(incident.spanSeconds),
        String(incident.outageIds.length),
        minutes(incident.downtimeSeconds),
      ]),
    ),
  ];
}

function durationsSection(ispOutages: Outage[], edge: number): string[] {
  if (ispOutages.length === 0) return [];
  const durations = ispOutages.map(o => outageSeconds(o, edge));
  const total = durations.reduce((a, b) => a + b, 0);
  let lower = 0;
  const rows = DURATION_BUCKETS.map(([label, upper]) => {
    const inBucket = durations.filter(d => d >= lower && d < upper);
    lower = upper;
    const seconds = inBucket.reduce((a, b) => a + b, 0);
    return [label, String(inBucket.length), minutes(seconds), total > 0 ? `${((seconds / total) * 100).toFixed(1)}%` : 'n/a'];
  });
  return [
    '## Outage durations',
    'ISP outages by how long they lasted, all time.',
    table(['Duration', 'ISP outages', 'ISP downtime (minutes)', 'Share of ISP downtime'], rows),
  ];
}

/**
 * Monitored time, ISP outages and downtime per hour of the day, since the app started
 * recording monitored time per hour. Without that, a device that only runs in the
 * daytime would seem to have only daytime outages.
 */
function timeOfDaySection(input: ReportInput, ispOutages: Outage[], edge: number): string[] {
  const byHour = input.monitoredByHour ?? {};
  const keys = Object.keys(byHour).sort();
  if (keys.length === 0) {
    return [
      '## Time of day',
      "Not available yet: the app hasn't recorded monitored time per hour. Use the start times in the CSV, together with the daily coverage table.",
    ];
  }
  const since = hourKeyStart(keys[0]);
  const monitored = new Array<number>(24).fill(0);
  const downtime = new Array<number>(24).fill(0);
  const started = new Array<number>(24).fill(0);
  const hourOf = (key: string) => Number(key.slice(11, 13));

  for (const key of keys) monitored[hourOf(key)] += byHour[key];
  if (input.lastCheckAt !== null) {
    forEachHour(input.lastCheckAt, edge, (key, ms) => {
      monitored[hourOf(key)] += ms;
    });
  }
  for (const outage of ispOutages) {
    const [start, end] = span(outage, edge);
    if (start >= since) started[new Date(start).getHours()] += 1;
    forEachHour(Math.max(start, since), end, (key, ms) => {
      downtime[hourOf(key)] += ms;
    });
  }

  const intro = [
    `Per local hour of the day, since ${formatLocalIso(since)}, when the app started recording monitored time per hour. Downtime share is ISP downtime as a share of the time monitored in that hour.`,
  ];
  if (ispOutages.some(o => Date.parse(o.startTime) < since)) {
    intro.push("Outages from before then aren't counted here; their start times are in the CSV.");
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    '## Time of day',
    intro.join(' '),
    table(
      ['Hour', 'Monitored (hours)', 'ISP outages started', 'ISP downtime (minutes)', 'Downtime share'],
      monitored.map((ms, hour) => [
        `${pad(hour)}:00–${pad(hour)}:59`,
        hours(ms / 1000),
        String(started[hour]),
        minutes(downtime[hour] / 1000),
        ms > 0 ? `${((downtime[hour] / ms) * 100).toFixed(1)}%` : 'n/a',
      ]),
    ),
  ];
}

/**
 * Monitored seconds within [from, to). Hours with a per-hour record count in proportion
 * to how much of them is in the window. Time from before per-hour records began is
 * spread evenly over the part of its day that tracking covered.
 */
export function monitoredBetween(input: StatsInput, from: number, to: number, edge: number): number {
  const byHour = input.monitoredByHour ?? {};
  const hourKeys = Object.keys(byHour).sort();
  const hourlySince = hourKeys.length > 0 ? hourKeyStart(hourKeys[0]) : Infinity;
  const trackingStart = input.trackingStartTime ? Date.parse(input.trackingStartTime) : -Infinity;
  const hourlyByDay = new Map<string, number>();
  let ms = 0;

  for (const key of hourKeys) {
    const start = hourKeyStart(key);
    ms += (byHour[key] * overlap(start, start + HOUR_MS, from, to)) / HOUR_MS;
    const day = key.slice(0, 10);
    hourlyByDay.set(day, (hourlyByDay.get(day) ?? 0) + byHour[key]);
  }

  for (const [day, dayMs] of Object.entries(input.monitoredByDay)) {
    const rest = dayMs - (hourlyByDay.get(day) ?? 0);
    if (rest <= 1000) continue;
    const [y, m, d] = day.split('-').map(Number);
    const dayStart = new Date(y, m - 1, d).getTime();
    const restFrom = Math.max(dayStart, trackingStart);
    const restTo = Math.min(startOfNextDay(dayStart), hourlySince, input.lastCheckAt ?? Infinity);
    if (restTo <= restFrom) continue;
    ms += (rest * overlap(restFrom, restTo, from, to)) / (restTo - restFrom);
  }

  if (input.lastCheckAt !== null) ms += overlap(input.lastCheckAt, edge, from, to);
  return ms / 1000;
}

/** Compares the periods the notes divide the history into: did the change a note records help? */
function notesSection(input: ReportInput, incidents: Incident[], edge: number, now: number): string[] {
  if (!input.trackingStartTime) return [];
  const trackingStart = Date.parse(input.trackingStartTime);
  const end = Math.max(now, edge);
  const notes = sortAnnotations(input.annotations).filter(note => {
    const time = Date.parse(note.time);
    return time > trackingStart && time < end;
  });
  if (notes.length === 0) return [];

  const bounds = [trackingStart, ...notes.map(note => Date.parse(note.time)), end];
  const counted = input.outages.filter(o => !o.flagged);
  const rows: string[][] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i];
    const to = bounds[i + 1];
    if (to <= from) continue;
    const monitored = monitoredBetween(input, from, to, edge);
    let isp = 0;
    let local = 0;
    let outages = 0;
    for (const outage of counted) {
      const [start, stop] = span(outage, edge);
      const seconds = overlap(start, stop, from, to) / 1000;
      if (outage.cause === 'local') {
        local += seconds;
      } else {
        isp += seconds;
        if (start >= from && start < to) outages += 1;
      }
    }
    const incidentCount = incidents.filter(incident => incident.start >= from && incident.start < to).length;
    const observable = monitored - local;
    rows.push([
      i === 0 ? 'Before the first note' : `After "${cellText(notes[i - 1].text)}"`,
      formatLocalIso(from),
      formatLocalIso(to),
      hours(monitored),
      String(outages),
      String(incidentCount),
      minutes(isp),
      monitored > 0 ? ((outages * 86400) / monitored).toFixed(1) : 'n/a',
      uptime(observable > 0 ? Math.max(0, Math.min(100, ((observable - isp) / observable) * 100)) : null),
    ]);
  }

  return [
    '## Before and after notes',
    "The notes divide the history into periods, each running until the next note (the last one until the export). Compare them to see whether a change a note records, like a new router, made a difference. Outages and incidents are counted in the period they started in; downtime that spans a note is split. Where a period's monitored time comes from days before the app recorded it per hour, it's estimated by spreading each day's total evenly.",
    table(
      ['Period', 'From (local)', 'To (local)', 'Monitored (hours)', 'ISP outages', 'Incidents', 'ISP downtime (minutes)', 'ISP outages per monitored day', 'ISP uptime'],
      rows,
    ),
  ];
}

/**
 * Builds a Markdown file meant for an LLM to analyze: what the data means, the app's
 * own summary figures, how much of each day was monitored, breakdowns by incident,
 * duration, time of day and the notes, and the outage and note history as CSV (the
 * same rows as the CSV export).
 */
export function buildReportMarkdown(input: ReportInput, options: ReportOptions): string {
  const { now, intervalMs, failureThreshold, ispName } = options;
  const timeZone = options.timeZone ?? localTimeZone();
  const stats = calculateStats(input, now, intervalMs);

  const meta = [
    `- Exported: ${formatLocalIso(now)}${timeZone ? ` (${timeZone})` : ''}`,
    `- Tracking since: ${stats.trackingStartTime ? formatLocalIso(stats.trackingStartTime) : 'not started'}`,
    `- Check interval: ${Math.round(intervalMs / 1000)} seconds; failure threshold: ${failureThreshold} failed checks in a row`,
  ];
  if (ispName) meta.push(`- Current ISP: ${ispName}`);

  const sections = [
    '# ISP outage data export',
    'Data from a browser-based monitor of a home internet connection. Read "How to read this data" before drawing conclusions.',
    meta.join('\n'),
    '## How to read this data',
    definitions(intervalMs, failureThreshold),
  ];

  if (stats.trackingStartTime) {
    const edge = liveEdge(input.lastCheckAt, now, intervalMs);
    const ispOutages = input.outages.filter(countsTowardIncidents);
    const incidents = groupIncidents(input.outages, { edge });
    const span = daysSince(Date.parse(stats.trackingStartTime), now);

    const last30 = dailyBreakdown(input, now, intervalMs, 30);
    const allTime = [
      'All time',
      hours(stats.monitoredSeconds),
      String(stats.ispOutages + stats.localOutages),
      minutes(stats.ispDowntime),
      minutes(stats.localDowntime),
      uptime(stats.monitoredSeconds - stats.localDowntime > 0 ? stats.uptimePercentage : null),
    ];
    // A window that reaches back past the start of tracking is the same as all time.
    const sameAsAllTime = (days: number) => input.legacyMonitoredMs === 0 && span <= days;
    const windows: Array<[string, number]> = [['Last 30 days', 30], ['Last 7 days', 7], ['Today', 1]];
    const shownWindows = windows.filter(([, days]) => !sameAsAllTime(days));
    const omitted = windows.filter(([, days]) => sameAsAllTime(days)).map(([label]) => label.toLowerCase());

    const coverage = stats.trackedSeconds > 0 ? (stats.monitoredSeconds / stats.trackedSeconds) * 100 : 100;
    const summaryNotes = [
      `- All time: ${stats.ispOutages} ISP ${stats.ispOutages === 1 ? 'outage' : 'outages'} and ${stats.localOutages} local network ${stats.localOutages === 1 ? 'outage' : 'outages'}, flagged ones excluded.`,
      `- Monitored ${hours(stats.monitoredSeconds)} of the ${hours(stats.trackedSeconds)} hours since tracking started (${Math.min(100, coverage).toFixed(1)}%).`,
      ...outageFacts(ispOutages, incidents, edge, stats.monitoredSeconds - stats.localDowntime - stats.ispDowntime),
    ];
    if (omitted.length > 0) {
      summaryNotes.push(`- Tracking started ${plural(span, 'day')} ago (counting today), so ${omitted.join(' and ')} would be the same as all time and ${omitted.length === 1 ? "isn't" : "aren't"} listed.`);
    }
    sections.push(
      '## Summary (as computed by the app)',
      table(
        ['Window', 'Monitored (hours)', 'Outages started', 'ISP downtime (minutes)', 'Local downtime (minutes)', 'ISP uptime'],
        [
          allTime,
          ...shownWindows.map(([label, days]) => windowRow(label, last30.slice(-days))),
        ],
      ),
      summaryNotes.join('\n'),
    );

    const shown = Math.min(span, MAX_COVERAGE_DAYS);
    const days = dailyBreakdown(input, now, intervalMs, shown);
    const intro = ['One row per local day, oldest first. 0.0 monitored hours means the app wasn\'t running that day; a partial figure means it ran for only part of it. Downtime that spans midnight is split between the days.'];
    if (shown < span) intro.push(`Only the last ${shown} of ${span} days are listed.`);
    if (input.legacyMonitoredMs > 0) {
      intro.push(`${hours(input.legacyMonitoredMs / 1000)} monitored hours from before the app recorded monitoring per day count toward the all-time figures but aren't in this table.`);
    }
    sections.push(
      '## Daily coverage',
      intro.join(' '),
      table(
        ['Date', 'Day', 'Monitored (hours)', 'ISP downtime (minutes)', 'Local downtime (minutes)', 'Outages started'],
        days.map(day => [
          day.day,
          new Date(day.start).toLocaleDateString('en-US', { weekday: 'long' }),
          hours(day.monitoredSeconds),
          minutes(day.ispSeconds),
          minutes(day.localSeconds),
          String(day.outages),
        ]),
      ),
      ...incidentsSection(incidents),
      ...durationsSection(ispOutages, edge),
      ...timeOfDaySection(input, ispOutages, edge),
      ...notesSection(input, incidents, edge, now),
    );
  }

  const csv = buildCsv(input.outages, input.annotations, timeZone);
  const fence = fenceFor(csv);
  sections.push(
    '## Outages and notes',
    'Every outage and note, oldest first, as CSV. The Type column tells them apart; columns that don\'t apply to a row, or that older records didn\'t track, are blank.',
    `${fence}csv\n${csv}\n${fence}`,
  );

  return sections.join('\n\n') + '\n';
}

export function exportReport(input: ReportInput, options: ReportOptions): void {
  downloadFile(
    `isp-outage-report-data-${dayKey(options.now)}.md`,
    [buildReportMarkdown(input, options)],
    'text/markdown;charset=utf-8',
  );
}
