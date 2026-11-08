import { Outage } from '@/types';
import { dayKey } from '@/lib/stats';

export const CSV_HEADERS = [
  'Start (local)',
  'End (local)',
  'Start (UTC, ISO 8601)',
  'End (UTC, ISO 8601)',
  'Duration (seconds)',
  'Duration (minutes)',
  'Cause',
  'ISP',
  'Flagged',
];

/** Spreadsheets run cells starting with these as formulas. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvCell(value: string): string {
  // The ISP name comes from a third-party API, so don't let it become a formula.
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Builds the CSV text, oldest outage first. Ongoing outages have blank end and duration cells. */
export function buildCsv(outages: Outage[]): string {
  const rows = [...outages]
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
    .map(outage => [
      new Date(outage.startTime).toLocaleString(),
      outage.endTime ? new Date(outage.endTime).toLocaleString() : 'Ongoing',
      new Date(outage.startTime).toISOString(),
      outage.endTime ? new Date(outage.endTime).toISOString() : '',
      outage.duration !== null ? String(Math.round(outage.duration)) : '',
      outage.duration !== null ? (outage.duration / 60).toFixed(2) : '',
      outage.cause === 'local' ? 'Local network' : 'ISP',
      outage.isp ?? '',
      outage.flagged ? 'Not an outage' : '',
    ]);

  return [CSV_HEADERS.join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\n');
}

export function exportToCSV(outages: Outage[], now: number = Date.now()): void {
  // The byte order mark makes Excel read the file as UTF-8 (ISP names, and the
  // narrow no-break space some browsers put in times).
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
