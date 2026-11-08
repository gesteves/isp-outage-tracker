export interface Outage {
  id: string;
  startTime: string; // ISO timestamp
  endTime: string | null; // null if ongoing
  duration: number | null; // seconds
}

export interface OutageStats {
  totalOutages: number;
  totalDowntime: number; // seconds
  uptimePercentage: number;
  trackingStartTime: string | null;
}

