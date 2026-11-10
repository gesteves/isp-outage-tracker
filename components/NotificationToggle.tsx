'use client';

import { useState } from 'react';
import { requestNotificationPermission } from '@/lib/notifications';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import Toggle from '@/components/Toggle';

const BLOCKED = 'Notifications are blocked in your browser settings.';

interface NotificationToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

/** The "notify when status changes" setting, which also asks for permission. */
export default function NotificationToggle({ enabled, onChange }: NotificationToggleProps) {
  const permission = useNotificationPermission();
  const [hint, setHint] = useState<string | null>(null);

  // No toggle where notifications aren't available, e.g. iPad and iPhone outside a home-screen app.
  if (permission === 'unsupported') return null;

  const checked = enabled && permission === 'granted';
  // Turned on here, then blocked in the browser's settings.
  const description = hint ?? (enabled && permission === 'denied' ? BLOCKED : null);

  const handleChange = async (on: boolean) => {
    if (!on) {
      onChange(false);
      setHint(null);
      return;
    }
    const result = await requestNotificationPermission();
    onChange(result === 'granted');
    setHint(result === 'granted' ? null : BLOCKED);
  };

  return (
    <Toggle
      label="Notify when status changes"
      checked={checked}
      onChange={on => void handleChange(on)}
      description={description}
    />
  );
}
