/** 'isp': the internet was unreachable. 'local': the device itself reported no network (Wi-Fi off, cable unplugged). */
export type OutageCause = 'isp' | 'local';

/** How one failed check failed. 'dns': sites by name were unreachable, but an IP address answered. 'all': nothing answered. */
export type CheckFailure = 'dns' | 'all';

/** How an outage's checks failed. 'mixed': some checks were DNS-only failures and some were total. */
export type OutageFailure = CheckFailure | 'mixed';

/**
 * 'restored': a check saw the connection come back.
 * 'gap': the app stopped checking (sleep, closed tab), so the real end is unknown
 * and the duration is a lower bound.
 */
export type OutageEndReason = 'restored' | 'gap';

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

  // The fields below are missing on records from before they were tracked.

  /** How the outage was closed. */
  endReason?: OutageEndReason;
  /** Check interval in effect when the outage began. */
  checkIntervalSeconds?: number;
  /** Failed checks in a row needed to log an outage, when this one began. */
  failureThreshold?: number;
  failure?: OutageFailure;
  /** Public IP and ASN last detected before the outage began (looked up at most an hour earlier). */
  ip?: string | null;
  asn?: string | null;
  /** ISP, public IP and ASN detected right after the connection came back. */
  ispAfter?: string | null;
  ipAfter?: string | null;
  asnAfter?: string | null;
  /** Median response time (ms) of the last few successful checks before the first failed one. */
  latencyBeforeMs?: number | null;
  /** Response time (ms) of the check that saw the connection come back. */
  latencyAfterMs?: number | null;
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
