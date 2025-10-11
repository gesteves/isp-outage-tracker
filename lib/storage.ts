import { Outage } from '@/types';

const OUTAGES_KEY = 'isp-outages';
const TRACKING_START_KEY = 'isp-tracking-start';

export const storage = {
  getOutages: (): Outage[] => {
    if (typeof window === 'undefined') return [];
    const data = localStorage.getItem(OUTAGES_KEY);
    if (!data) return [];
    try {
      return JSON.parse(data);
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
  },

  getTrackingStartTime: (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TRACKING_START_KEY);
  },

  setTrackingStartTime: (time: string): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TRACKING_START_KEY, time);
  },
};

