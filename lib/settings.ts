/** Per-device preferences. Unlike tracker data, any tab may write these. */
export const SETTINGS_KEY = 'isp-tracker-settings';
const SETTINGS_VERSION = 1;

export interface Settings {
  keepScreenOn: boolean;
  /** Notify when an outage starts and when the connection comes back. */
  notifyOnStatusChange: boolean;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  keepScreenOn: false,
  notifyOnStatusChange: false,
});

export interface SettingsStore {
  /** Returns the same object until settings change, as useSyncExternalStore requires. */
  get: () => Settings;
  set: (patch: Partial<Settings>) => void;
  subscribe: (listener: () => void) => () => void;
}

function read(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SETTINGS;
    return {
      keepScreenOn: parsed.keepScreenOn === true,
      notifyOnStatusChange: parsed.notifyOnStatusChange === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function createSettingsStore(): SettingsStore {
  let cached: Settings | null = null;
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach(listener => listener());

  // Another tab changed the settings.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SETTINGS_KEY && event.key !== null) return;
    cached = read();
    notify();
  };

  return {
    get() {
      if (cached === null) cached = read();
      return cached;
    },

    set(patch) {
      const next = { ...(cached ?? read()), ...patch };
      cached = next;
      if (typeof window !== 'undefined') {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: SETTINGS_VERSION, ...next }));
      }
      notify();
    },

    subscribe(listener) {
      if (listeners.size === 0 && typeof window !== 'undefined') {
        window.addEventListener('storage', onStorage);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== 'undefined') {
          window.removeEventListener('storage', onStorage);
        }
      };
    },
  };
}

export const settingsStore = createSettingsStore();
