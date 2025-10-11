import { Outage, OutageStats } from '@/types';
import { formatDistanceToNow, formatDuration, intervalToDuration } from 'date-fns';

export function calculateStats(outages: Outage[], trackingStartTime: string | null): OutageStats {
  if (!trackingStartTime) {
    return {
      totalOutages: 0,
      totalDowntime: 0,
      uptimePercentage: 100,
      trackingStartTime: null,
    };
  }

  const now = Date.now();
  const start = new Date(trackingStartTime).getTime();
  const totalTrackingTime = (now - start) / 1000; // seconds

  let totalDowntime = 0;

  outages.forEach(outage => {
    if (outage.duration !== null) {
      totalDowntime += outage.duration;
    } else {
      // Ongoing outage
      const outageDuration = (now - new Date(outage.startTime).getTime()) / 1000;
      totalDowntime += outageDuration;
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

export function formatTimeAgo(timestamp: string): string {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

export function formatDurationFromSeconds(seconds: number): string {
  if (seconds === 0) return '0s';
  
  const duration = intervalToDuration({ start: 0, end: seconds * 1000 });
  
  const parts = [];
  if (duration.days && duration.days > 0) parts.push(`${duration.days}d`);
  if (duration.hours && duration.hours > 0) parts.push(`${duration.hours}h`);
  if (duration.minutes && duration.minutes > 0) parts.push(`${duration.minutes}m`);
  if (duration.seconds && duration.seconds > 0) parts.push(`${duration.seconds}s`);
  
  // If all parts are 0 but seconds is not 0, show seconds
  if (parts.length === 0 && seconds > 0) {
    parts.push(`${Math.floor(seconds)}s`);
  }
  
  return parts.length > 0 ? parts.join(' ') : '0s';
}

export function exportToCSV(outages: Outage[]): void {
  const headers = ['Start Time', 'End Time', 'Duration (minutes)'];
  const rows = outages.map(outage => [
    new Date(outage.startTime).toLocaleString(),
    outage.endTime ? new Date(outage.endTime).toLocaleString() : 'Ongoing',
    outage.duration ? (outage.duration / 60).toFixed(2) : 'N/A',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
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
}

