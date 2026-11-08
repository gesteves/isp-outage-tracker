import { Outage, OutageStats } from '@/types';
import { formatDistanceToNow } from 'date-fns';

export function calculateStats(
  outages: Outage[],
  trackingStartTime: string | null,
  now: number = Date.now(),
): OutageStats {
  if (!trackingStartTime) {
    return {
      totalOutages: 0,
      totalDowntime: 0,
      uptimePercentage: 100,
      trackingStartTime: null,
    };
  }

  const start = new Date(trackingStartTime).getTime();
  const totalTrackingTime = (now - start) / 1000; // seconds

  let totalDowntime = 0;

  outages.forEach(outage => {
    if (outage.duration !== null) {
      totalDowntime += outage.duration;
    } else {
      // Ongoing outage
      totalDowntime += Math.max(0, (now - new Date(outage.startTime).getTime()) / 1000);
    }
  });

  const uptimePercentage = totalTrackingTime > 0
    ? ((totalTrackingTime - totalDowntime) / totalTrackingTime) * 100
    : 100;

  return {
    totalOutages: outages.length,
    totalDowntime,
    uptimePercentage: Math.max(0, Math.min(100, uptimePercentage)),
    trackingStartTime,
  };
}

/**
 * Formats a percentage to 2 decimals, rounding *down* so any downtime at all
 * keeps it below "100.00".
 */
export function formatPercentage(value: number): string {
  // The epsilon absorbs float error (e.g. 1.13 * 100 === 112.99999999999999).
  return (Math.floor(value * 100 + 1e-9) / 100).toFixed(2);
}

export function formatTimeAgo(timestamp: string): string {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

/** Formats seconds as e.g. "1d 2h 3m 4s", omitting zero parts. */
export function formatDurationFromSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function exportToCSV(outages: Outage[]): void {
  const headers = ['Start Time', 'End Time', 'Duration (minutes)'];
  const rows = outages.map(outage => [
    new Date(outage.startTime).toLocaleString(),
    outage.endTime ? new Date(outage.endTime).toLocaleString() : 'Ongoing',
    outage.duration !== null ? (outage.duration / 60).toFixed(2) : 'N/A',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(csvCell).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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
