import { Annotation, Outage, OutageEndReason, OutageFailure } from '@/types';
import { sortAnnotations } from '@/lib/annotations';
import { downloadFile } from '@/lib/download';
import { formatLocalIso } from '@/lib/format';
import { dayKey } from '@/lib/stats';

export const CSV_HEADERS = [
  'Type',
  'Start (local)',
  'End (local)',
  'Start (UTC, ISO 8601)',
  'End (UTC, ISO 8601)',
  'Time zone',
  'Day of week',
  'Duration (seconds)',
  'Duration (minutes)',
  'Since previous outage (seconds)',
  'Cause',
  'Failure type',
  'Ended by',
  'ISP',
  'ISP after',
  'Public IP before',
  'Public IP after',
  'ASN before',
  'ASN after',
  'Response time before (ms)',
  'Response time after (ms)',
  'Check interval (seconds)',
  'Failure threshold',
  'Flagged',
  'Note',
];

const FAILURE_LABELS: Record<OutageFailure, string> = {
  all: 'All targets',
  dns: 'DNS only',
  mixed: 'Mixed',
};

const END_LABELS: Record<OutageEndReason, string> = {
  restored: 'Connection restored',
  gap: 'Monitoring stopped',
};

/** Spreadsheets run cells starting with these as formulas. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvCell(value: string): string {
  // ISP names come from a third-party API and notes are free text, so don't let either
  // become a formula.
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

const text = (value: string | null | undefined) => value ?? '';
const number = (value: number | null | undefined) => (value == null ? '' : String(value));

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/** Values for the time columns that outage and note rows share, from 'Start (local)' to 'Day of week'. */
function timeCells(startMs: number, endMs: number | null, ongoing: boolean, timeZone: string): string[] {
  return [
    formatLocalIso(startMs),
    endMs !== null ? formatLocalIso(endMs) : ongoing ? 'Ongoing' : '',
    new Date(startMs).toISOString(),
    endMs !== null ? new Date(endMs).toISOString() : '',
    timeZone,
    new Date(startMs).toLocaleDateString('en-US', { weekday: 'long' }),
  ];
}

function outageRow(outage: Outage, previous: Outage | null, timeZone: string): string[] {
  const startMs = Date.parse(outage.startTime);
  const endMs = outage.endTime ? Date.parse(outage.endTime) : null;
  // Minutes come from the rounded seconds, so the two columns agree.
  const seconds = outage.duration !== null ? Math.round(outage.duration) : null;
  const previousEnd = previous?.endTime ?? null;
  return [
    'Outage',
    ...timeCells(startMs, endMs, endMs === null, timeZone),
    number(seconds),
    seconds !== null ? (seconds / 60).toFixed(2) : '',
    previousEnd ? String(Math.round((startMs - Date.parse(previousEnd)) / 1000)) : '',
    outage.cause === 'local' ? 'Local network' : 'ISP',
    outage.failure ? FAILURE_LABELS[outage.failure] : '',
    outage.endReason ? END_LABELS[outage.endReason] : '',
    text(outage.isp),
    text(outage.ispAfter),
    text(outage.ip),
    text(outage.ipAfter),
    text(outage.asn),
    text(outage.asnAfter),
    number(outage.latencyBeforeMs),
    number(outage.latencyAfterMs),
    number(outage.checkIntervalSeconds),
    number(outage.failureThreshold),
    outage.flagged ? 'Not an outage' : '',
    '',
  ];
}

function noteRow(note: Annotation, timeZone: string): string[] {
  const cells = ['Note', ...timeCells(Date.parse(note.time), null, false, timeZone)];
  // Every outage-only column is blank; the text goes in the last one.
  while (cells.length < CSV_HEADERS.length - 1) cells.push('');
  return [...cells, note.text];
}

/**
 * Builds the CSV text: outages and notes in one list, oldest first, told apart by the
 * Type column. A note at the same time as an outage's start comes before it, since it's
 * usually the cause. Ongoing outages have blank end and duration cells, and fields that
 * older records didn't track are blank too.
 */
export function buildCsv(
  outages: Outage[],
  annotations: Annotation[] = [],
  timeZone: string = localTimeZone(),
): string {
  const sortedOutages = [...outages].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const sortedNotes = sortAnnotations(annotations);

  const rows: string[][] = [];
  let o = 0;
  let n = 0;
  while (o < sortedOutages.length || n < sortedNotes.length) {
    const outage = sortedOutages[o];
    const note = sortedNotes[n];
    if (note && (!outage || Date.parse(note.time) <= Date.parse(outage.startTime))) {
      rows.push(noteRow(note, timeZone));
      n++;
    } else {
      // "Since previous outage" skips over notes: it's measured from the outage before.
      rows.push(outageRow(outage, o > 0 ? sortedOutages[o - 1] : null, timeZone));
      o++;
    }
  }

  return [CSV_HEADERS, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
}

export function exportToCSV(outages: Outage[], annotations: Annotation[] = [], now: number = Date.now()): void {
  // The byte order mark makes Excel read the file as UTF-8 (ISP names can have
  // non-ASCII characters). The local date, so an evening export isn't named after
  // tomorrow (UTC).
  downloadFile(`isp-outages-${dayKey(now)}.csv`, ['\uFEFF', buildCsv(outages, annotations)], 'text/csv;charset=utf-8;');
}
