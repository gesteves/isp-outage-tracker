import { Outage } from '@/types';

export const CSV_HEADERS = [
  'Start (local)',
  'End (local)',
  'Start (UTC, ISO 8601)',
  'End (UTC, ISO 8601)',
  'Duration (seconds)',
  'Duration (minutes)',
  'Cause',
  'ISP',
];

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
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
    ]);

  return [CSV_HEADERS.join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\n');
}

export function exportToCSV(outages: Outage[]): void {
  const blob = new Blob([buildCsv(outages)], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `isp-outages-${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking synchronously can cancel the download in some browsers, so wait a bit.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
