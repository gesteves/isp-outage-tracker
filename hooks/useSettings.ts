'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, Settings, SettingsStore, settingsStore } from '@/lib/settings';

const getServerSnapshot = () => DEFAULT_SETTINGS;

export function useSettings(
  store: SettingsStore = settingsStore,
): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(store.subscribe, store.get, getServerSnapshot);
  return [settings, store.set];
}
