import { Outage } from '@/types';

const OUTAGES_KEY = 'isp-outages';
const TRACKING_START_KEY = 'isp-tracking-start';
const LAST_CHECK_KEY = 'isp-last-check';

export const storage = {
  getOutages: (): Outage[] => {
    if (typeof window === 'undefined') return [];
    const data = localStorage.getItem(OUTAGES_KEY);
    if (!data) return [];
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  setOutages: (outages: Outage[]): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(OUTAGES_KEY, JSON.stringify(outages));
  },

  addOutage: (outage: Outage): void => {
    const outages = storage.getOutages();
    outages.push(outage);
    storage.setOutages(outages);
  },

  updateOutage: (id: string, updates: Partial<Outage>): void => {
    const outages = storage.getOutages();
    const index = outages.findIndex(o => o.id === id);
    if (index !== -1) {
      outages[index] = { ...outages[index], ...updates };
      storage.setOutages(outages);
    }
  },

  clearOutages: (): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(OUTAGES_KEY);
    localStorage.removeItem(TRACKING_START_KEY);
    localStorage.removeItem(LAST_CHECK_KEY);
  },

  getTrackingStartTime: (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TRACKING_START_KEY);
  },

  setTrackingStartTime: (time: string): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TRACKING_START_KEY, time);
  },

  /** When the last connectivity check ran (epoch ms), used to detect gaps across reloads. */
  getLastCheckAt: (): number | null => {
    if (typeof window === 'undefined') return null;
    const value = localStorage.getItem(LAST_CHECK_KEY);
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  },

  setLastCheckAt: (ms: number): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(LAST_CHECK_KEY, new Date(ms).toISOString());
  },
};
