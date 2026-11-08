/** 'isp': the internet was unreachable. 'local': the device itself reported no network (Wi-Fi off, cable unplugged). */
export type OutageCause = 'isp' | 'local';

export interface Outage {
  id: string;
  startTime: string; // ISO timestamp
  endTime: string | null; // null if ongoing
  duration: number | null; // seconds
  /** Missing on records from before causes were tracked; treat as 'isp'. */
  cause?: OutageCause;
  /** ISP name last detected before the outage began. */
  isp?: string | null;
}

export interface OutageStats {
  trackingStartTime: string | null;
  /** Wall-clock time since tracking started (seconds). */
  trackedSeconds: number;
  /** Time the app was actually running checks (seconds). */
  monitoredSeconds: number;
  ispOutages: number;
  ispDowntime: number; // seconds
  localOutages: number;
  localDowntime: number; // seconds
  /** ISP uptime over the time the app could observe it. */
  uptimePercentage: number;
}
