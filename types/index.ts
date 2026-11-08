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
  /** Marked by the user as not a real outage (e.g. a false alarm). Kept, but left out of stats. */
  flagged?: boolean;
}

/** One local day of the daily breakdown. */
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
