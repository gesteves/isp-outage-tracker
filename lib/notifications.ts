import { Outage } from '@/types';
import { formatClockTime, formatDurationFromSeconds } from '@/lib/format';
import { SettingsStore, settingsStore } from '@/lib/settings';

/**
 * One tag for both notifications: "back online" replaces the "down" notification
 * instead of piling up under it. `renotify` makes the replacement alert again.
 */
export const STATUS_TAG = 'isp-status';
const ICON = '/icons/icon-192.png';

export type StatusChange = 'down' | 'up';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** iPhone or iPad, including iPads that report a desktop Mac user agent. */
export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** Running as an installed home-screen app rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const legacyIOS = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return legacyIOS || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  return Notification.requestPermission();
}

export function statusMessage(change: StatusChange, outage: Outage): { title: string; body: string } {
  const cause = outage.cause === 'local' ? ' · Local network' : '';
  if (change === 'down') {
    return { title: 'Internet is down', body: `Since ${formatClockTime(outage.startTime)}${cause}` };
  }
  const duration = formatDurationFromSeconds(outage.duration ?? 0);
  const span = outage.endTime
    ? ` (${formatClockTime(outage.startTime)}–${formatClockTime(outage.endTime)})`
    : '';
  return { title: 'Internet is back', body: `Down for ${duration}${span}${cause}` };
}

/**
 * Shows a status-change notification if the user turned them on, granted
 * permission, and isn't looking at the page already. Notifying that the internet
 * went down works offline: the notification is local, not a push.
 */
export async function notifyStatusChange(
  change: StatusChange,
  outage: Outage,
  { settings = settingsStore }: { settings?: SettingsStore } = {},
): Promise<void> {
  if (!notificationsSupported()) return;
  if (!settings.get().notifyOnStatusChange || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;

  const { title, body } = statusMessage(change, outage);
  // `renotify` isn't in TypeScript's DOM types yet.
  const options: NotificationOptions & { renotify?: boolean } = {
    body,
    tag: STATUS_TAG,
    renotify: true,
    icon: ICON,
  };
  try {
    // Installed apps on iOS and Android can only notify through the service worker.
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
  } catch (error) {
    console.error('Error showing notification:', error);
  }
}

export const notifyOutageStarted = (outage: Outage) => notifyStatusChange('down', outage);
export const notifyOutageEnded = (outage: Outage) => notifyStatusChange('up', outage);
