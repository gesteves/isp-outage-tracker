import { Outage, OutageEndReason, OutageFailure } from '@/types';
import { formatLocalIso } from '@/lib/format';
import { dayKey } from '@/lib/stats';

export const CSV_HEADERS = [
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
  // The ISP name comes from a third-party API, so don't let it become a formula.
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

const text = (value: string | null | undefined) => value ?? '';
const number = (value: number | null | undefined) => (value == null ? '' : String(value));

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/**
 * Builds the CSV text, oldest outage first. Ongoing outages have blank end and duration
 * cells, and fields that older records didn't track are blank too.
 */
export function buildCsv(outages: Outage[], timeZone: string = localTimeZone()): string {
  const sorted = [...outages].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const rows = sorted.map((outage, i) => {
    const startMs = Date.parse(outage.startTime);
    const endMs = outage.endTime ? Date.parse(outage.endTime) : null;
    // Minutes come from the rounded seconds, so the two columns agree.
    const seconds = outage.duration !== null ? Math.round(outage.duration) : null;
    const previousEnd = i > 0 ? sorted[i - 1].endTime : null;
    return [
      formatLocalIso(startMs),
      endMs !== null ? formatLocalIso(endMs) : 'Ongoing',
      new Date(startMs).toISOString(),
      endMs !== null ? new Date(endMs).toISOString() : '',
      timeZone,
      new Date(startMs).toLocaleDateString('en-US', { weekday: 'long' }),
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
    ];
  });

  return [CSV_HEADERS, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
}

export function exportToCSV(outages: Outage[], now: number = Date.now()): void {
  // The byte order mark makes Excel read the file as UTF-8 (ISP names can have
  // non-ASCII characters).
  const blob = new Blob(['﻿', buildCsv(outages)], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  // The local date, so an evening export isn't named after tomorrow (UTC).
  link.setAttribute('download', `isp-outages-${dayKey(now)}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking synchronously can cancel the download in some browsers, so wait a bit.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
