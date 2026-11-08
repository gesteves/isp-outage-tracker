'use client';

import { useSyncExternalStore } from 'react';
import { notificationsSupported } from '@/lib/notifications';

export type NotificationPermissionState = NotificationPermission | 'unsupported';

const read = (): NotificationPermissionState =>
  notificationsSupported() ? Notification.permission : 'unsupported';

const readOnServer = (): NotificationPermissionState => 'unsupported';

function subscribe(onChange: () => void): () => void {
  let status: PermissionStatus | null = null;
  let unsubscribed = false;

  // Fires when the permission changes, including from the browser's own settings.
  navigator.permissions
    ?.query({ name: 'notifications' as PermissionName })
    .then(result => {
      if (unsubscribed) return;
      status = result;
      status.addEventListener('change', onChange);
    })
    .catch(() => {});
  // Where the Permissions API can't tell us, catch up when the page is shown again.
  document.addEventListener('visibilitychange', onChange);

  return () => {
    unsubscribed = true;
    status?.removeEventListener('change', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
}

/** The notification permission, kept current when it changes outside the page. */
export function useNotificationPermission(): NotificationPermissionState {
  return useSyncExternalStore(subscribe, read, readOnServer);
}
