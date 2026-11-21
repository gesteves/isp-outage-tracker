import { Annotation, DayStats } from '@/types';
import { buildCsv, localTimeZone } from '@/lib/csv';
import { downloadFile } from '@/lib/download';
import { formatLocalIso, formatPercentage } from '@/lib/format';
import { FAST_RETRY_MS } from '@/lib/monitor';
import { StatsInput, calculateStats, dailyBreakdown, dayKey, startOfNextDay, windowUptime } from '@/lib/stats';

/** Most days the daily coverage table lists, so years of history don't make an unwieldy file. */
export const MAX_COVERAGE_DAYS = 366;

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

function table(headers: string[], rows: string[][]): string {
  return [headers, headers.map(() => '---'), ...rows].map(row => `| ${row.join(' | ')} |`).join('\n');
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
  return [
    `- **Monitoring coverage.** The app only sees outages while it's open in a browser tab. Time it wasn't running (device asleep, tab closed) counts as neither uptime nor downtime. Use the daily coverage table to tell "no outages" apart from "not monitored", and don't measure uptime against calendar time.`,
    `- **Checks.** Every ${interval} seconds the app requests cloudflare.com and google.com (which need DNS) and 1.1.1.1 and 8.8.8.8 (which don't). A check fails when neither named site answers. While a check is failing, the next one runs after ${retry} seconds.`,
    `- **Outages.** Logged after ${failureThreshold} failed checks in a row. Start is backdated to the first failed check; End is the check that saw the connection come back. Durations are accurate to within about ${retry} seconds.`,
    '- **Cause.** `ISP`: the internet was unreachable while the device had a network. `Local network`: every failed check happened while the device reported no network at all (Wi-Fi off, cable unplugged). Local outages are on the user\'s side and are left out of ISP uptime and downtime.',
    '- **Failure type.** `DNS only`: the named sites failed but an IP address still answered. `All targets`: nothing answered. `Mixed`: both kinds of failure happened during the outage.',
    '- **Ended by.** `Connection restored`: a check saw the connection come back. `Monitoring stopped`: the app stopped checking during the outage, so it was closed at the last check that saw the connection down. Its real end is unknown and its duration is a lower bound.',
    '- **Flagged.** `Not an outage`: the user marked it as a false alarm. It\'s left out of every figure in this file.',
    '- **Ongoing.** An outage whose End is `Ongoing` was still in progress when this file was exported. The figures count it up to the export time.',
    '- **ISP, public IP and ASN.** The "before" values come from the last lookup before the outage and can be up to an hour old. The "after" values are looked up right after the connection came back. A change suggests a modem restart, a reassigned address or a failover link.',
    '- **Response times.** "Before": the median of the last few successful checks before the first failed one. "After": the check that saw the connection come back.',
    '- **Since previous outage.** Seconds from the end of the previous outage (of any cause, flagged or not) to the start of this one.',
    '- **Notes.** Rows with Type `Note` were written by the user, e.g. "new router". Their Start is when the noted event happened. They don\'t affect any figure, but may explain outages around them.',
    '- **ISP uptime** = (monitored time − local downtime − ISP downtime) ÷ (monitored time − local downtime). It\'s shown rounded down to 2 decimals, so any downtime keeps it below 100.00%.',
    '- **Times.** Local times carry their UTC offset; UTC times end in `Z`. Days in the tables are local calendar days.',
    "- **Spreadsheet escapes.** A CSV cell that starts with `'` followed by `=`, `+`, `-` or `@` had the apostrophe added so spreadsheets don't run it as a formula. Ignore the apostrophe.",
  ].join('\n');
}

/**
 * Builds a Markdown file meant for an LLM to analyze: what the data means, the app's
 * own summary figures, how much of each day was monitored, and the outage and note
 * history as CSV (the same rows as the CSV export).
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
    const last30 = dailyBreakdown(input, now, intervalMs, 30);
    const allTime = [
      'All time',
      hours(stats.monitoredSeconds),
      String(stats.ispOutages + stats.localOutages),
      minutes(stats.ispDowntime),
      minutes(stats.localDowntime),
      uptime(stats.monitoredSeconds - stats.localDowntime > 0 ? stats.uptimePercentage : null),
    ];
    const coverage = stats.trackedSeconds > 0 ? (stats.monitoredSeconds / stats.trackedSeconds) * 100 : 100;
    const summaryNotes = [
      `- All time: ${stats.ispOutages} ISP ${stats.ispOutages === 1 ? 'outage' : 'outages'} and ${stats.localOutages} local network ${stats.localOutages === 1 ? 'outage' : 'outages'}, flagged ones excluded.`,
      `- Monitored ${hours(stats.monitoredSeconds)} of the ${hours(stats.trackedSeconds)} hours since tracking started (${Math.min(100, coverage).toFixed(1)}%).`,
    ];
    sections.push(
      '## Summary (as computed by the app)',
      table(
        ['Window', 'Monitored (hours)', 'Outages started', 'ISP downtime (minutes)', 'Local downtime (minutes)', 'ISP uptime'],
        [
          allTime,
          windowRow('Last 30 days', last30),
          windowRow('Last 7 days', last30.slice(-7)),
          windowRow('Today', last30.slice(-1)),
        ],
      ),
      summaryNotes.join('\n'),
    );

    const span = daysSince(Date.parse(stats.trackingStartTime), now);
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
