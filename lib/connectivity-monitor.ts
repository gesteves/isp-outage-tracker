import { Outage } from '@/types';
import { checkConnectivity } from '@/lib/connectivity';
import { CHECK_INTERVAL_MS, FAILURE_THRESHOLD } from '@/lib/config';
import { detectISP } from '@/lib/isp-detection';
import { TrackerData, clearData, emptyData, loadData, saveData } from '@/lib/storage';
import { accrueMonitoredTime } from '@/lib/stats';
import { TabCoordinator, TabMessage, createTabCoordinator } from '@/lib/tab-coordinator';
import {
  ConnectionStatus,
  MonitorState,
  applyCheck,
  initialMonitorState,
  isGap,
  newOutageId,
  nextCheckDelay,
  upsertOutage,
} from '@/lib/monitor';

export type MonitorRole = 'leader' | 'follower';

export interface MonitorSnapshot {
  /** False until state has been loaded from localStorage on the client. */
  loaded: boolean;
  /** Only the leader tab runs checks; followers show what it sends them. */
  role: MonitorRole;
  status: ConnectionStatus;
  outages: Outage[];
  trackingStartTime: string | null;
  currentOutage: Outage | null;
  lastCheckAt: number | null;
  nextCheckAt: number | null;
  checking: boolean;
  ispName: string | null;
  monitoredByDay: Record<string, number>;
  legacyMonitoredMs: number;
}

export interface ConnectivityMonitor {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => MonitorSnapshot;
  getServerSnapshot: () => MonitorSnapshot;
  /** Loads persisted state and starts monitoring (or following another tab). Returns a stop function. */
  start: () => () => void;
  clearHistory: () => void;
  /** Checks as soon as possible. If a check is running, queues one more right after it. */
  checkNow: () => void;
  /** Checks now if the next check is already overdue, e.g. after timers were throttled. */
  checkIfOverdue: () => void;
}

export interface MonitorDeps {
  check?: () => Promise<boolean>;
  /** Whether the device reports any network at all (navigator.onLine). */
  deviceOnline?: () => boolean;
  now?: () => number;
  intervalMs?: number;
  threshold?: number;
  newId?: () => string;
  detectIsp?: (options: { force: boolean }) => Promise<string | null>;
  /** Called by the leader tab when an outage is confirmed, e.g. to show a notification. */
  onOutageStarted?: (outage: Outage) => void;
  /** Called by the leader tab when the connection is seen coming back. */
  onOutageEnded?: (outage: Outage) => void;
  coordinator?: TabCoordinator<MonitorSnapshot>;
}

const SERVER_SNAPSHOT: MonitorSnapshot = {
  loaded: false,
  role: 'follower',
  status: 'unknown',
  outages: [],
  trackingStartTime: null,
  currentOutage: null,
  lastCheckAt: null,
  nextCheckAt: null,
  checking: false,
  ispName: null,
  monitoredByDay: {},
  legacyMonitoredMs: 0,
};

const defaultDeviceOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/**
 * Runs connectivity checks on a single self-rescheduling timer and persists
 * outages. Only one check runs at a time, and start/stop are safe to call
 * repeatedly, so React StrictMode's double-mounted effects can't cause
 * duplicate checks or duplicate outages.
 *
 * With several tabs open, only the leader tab checks and writes storage; the
 * others mirror it over a BroadcastChannel (see lib/tab-coordinator.ts).
 */
export function createConnectivityMonitor({
  check = checkConnectivity,
  deviceOnline = defaultDeviceOnline,
  now = Date.now,
  intervalMs = CHECK_INTERVAL_MS,
  threshold = FAILURE_THRESHOLD,
  newId = newOutageId,
  detectIsp = detectISP,
  onOutageStarted,
  onOutageEnded,
  coordinator: providedCoordinator,
}: MonitorDeps = {}): ConnectivityMonitor {
  const listeners = new Set<() => void>();
  let snapshot = SERVER_SNAPSHOT;
  // Created on first start: it touches browser APIs, and the monitor is also constructed during SSR.
  let coordinator = providedCoordinator ?? null;

  let loaded = false;
  let running = false;
  let role: MonitorRole = 'follower';
  let inFlight = false;
  let recheckQueued = false;
  /** Incremented on clear and on leadership changes, so a check already in flight is discarded. */
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nextCheckAt: number | null = null;
  let ispName: string | null = null;
  let stopFollowing: (() => void) | null = null;
  let releaseLeadership: (() => void) | null = null;

  let data: TrackerData = emptyData();
  let state: MonitorState = initialMonitorState(null, null);
  /** The latest snapshot from the leader, shown while this tab is a follower. */
  let remote: MonitorSnapshot | null = null;

  function buildSnapshot(): MonitorSnapshot {
    if (role === 'follower' && remote) {
      return { ...remote, loaded: true, role: 'follower' };
    }
    return {
      loaded,
      role,
      status: state.status,
      outages: data.outages,
      trackingStartTime: data.trackingStartTime,
      currentOutage: state.currentOutage,
      lastCheckAt: state.lastCheckAt,
      nextCheckAt: role === 'leader' ? nextCheckAt : null,
      checking: inFlight,
      ispName,
      monitoredByDay: data.monitoredByDay,
      legacyMonitoredMs: data.legacyMonitoredMs,
    };
  }

  function emit() {
    snapshot = buildSnapshot();
    listeners.forEach(listener => listener());
    if (role === 'leader') coordinator?.post({ type: 'snapshot', snapshot });
  }

  function restoreState() {
    const ongoing = data.outages.find(o => o.endTime === null) ?? null;
    state = initialMonitorState(ongoing, data.lastCheckAt, data.streak);
  }

  function save() {
    try {
      saveData(data);
    } catch (error) {
      // e.g. localStorage quota exceeded; keep monitoring with in-memory state.
      console.error('Error saving outage data:', error);
    }
  }

  async function refreshIsp(force: boolean) {
    try {
      const name = await detectIsp({ force });
      if (name && name !== ispName) {
        ispName = name;
        emit();
      }
    } catch (error) {
      console.debug('ISP detection failed:', error);
    }
  }

  function schedule(delayMs: number) {
    if (timer !== null) clearTimeout(timer);
    nextCheckAt = now() + delayMs;
    timer = setTimeout(runCheck, delayMs);
    emit();
  }

  function cancelTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    nextCheckAt = null;
  }

  function notify(handler: ((outage: Outage) => void) | undefined, outage: Outage) {
    try {
      handler?.(outage);
    } catch (error) {
      console.error('Error in outage handler:', error);
    }
  }

  function record(online: boolean, at: number, deviceIsOnline: boolean) {
    const previousCheck = state.lastCheckAt;
    const result = applyCheck(
      state,
      { online, at, deviceOnline: deviceIsOnline },
      { threshold, intervalMs, newId, isp: ispName },
    );
    state = result.state;

    let { outages, monitoredByDay } = data;
    for (const event of result.events) outages = upsertOutage(outages, event.outage);
    if (previousCheck !== null && !isGap(previousCheck, at, intervalMs)) {
      monitoredByDay = accrueMonitoredTime(monitoredByDay, previousCheck, at);
    }
    data = { ...data, outages, monitoredByDay, lastCheckAt: at, streak: state.streak };
    save();

    for (const event of result.events) {
      if (event.type === 'started') notify(onOutageStarted, event.outage);
      if (event.type !== 'ended') continue;
      if (!event.gap) notify(onOutageEnded, event.outage);
      // The connection may have come back on a different ISP (e.g. a failover link).
      void refreshIsp(true);
    }
  }

  async function runCheck() {
    timer = null;
    if (inFlight || role !== 'leader') return;

    inFlight = true;
    emit();

    const startedGeneration = generation;
    const at = now();
    const deviceIsOnline = deviceOnline();
    let online: boolean | null = null;
    try {
      online = await check();
    } catch (error) {
      console.error('Error checking connectivity:', error);
    }

    inFlight = false;
    const stale = startedGeneration !== generation;
    if (online !== null && !stale && role === 'leader') {
      record(online, at, deviceIsOnline);
    }

    if (running && role === 'leader') {
      const delay = stale || recheckQueued ? 0 : nextCheckDelay(state, intervalMs);
      recheckQueued = false;
      schedule(delay);
    } else {
      emit();
    }
  }

  function becomeLeader() {
    if (!running) return;
    role = 'leader';
    generation += 1;
    remote = null;

    // Another tab may have been writing until a moment ago, so start from what's stored.
    const loadedData = loadData(now());
    data = loadedData.data;
    let changed = loadedData.changed;
    if (!data.trackingStartTime) {
      data = { ...data, trackingStartTime: new Date(now()).toISOString() };
      changed = true;
    }
    if (changed) save();
    restoreState();

    if (!inFlight) schedule(0);
    else emit();
    void refreshIsp(false);
  }

  function handleMessage(message: TabMessage<MonitorSnapshot>) {
    if (role === 'leader') {
      if (message.type === 'hello') coordinator?.post({ type: 'snapshot', snapshot });
      else if (message.type === 'clear') clearHistory();
      else if (message.type === 'checkNow') checkNow();
    } else if (message.type === 'snapshot') {
      remote = message.snapshot;
      emit();
    }
  }

  function stop() {
    if (!running) return;
    running = false;
    stopFollowing?.();
    stopFollowing = null;
    releaseLeadership?.();
    releaseLeadership = null;
    cancelTimer();
    if (role === 'leader') {
      role = 'follower';
      generation += 1;
    }
  }

  function checkNow() {
    if (!running) return;
    if (role !== 'leader') {
      coordinator?.post({ type: 'checkNow' });
      return;
    }
    if (inFlight) {
      recheckQueued = true;
      return;
    }
    schedule(0);
  }

  function clearHistory() {
    if (role !== 'leader') {
      coordinator?.post({ type: 'clear' });
      return;
    }
    generation += 1;
    clearData();
    data = { ...emptyData(), trackingStartTime: new Date(now()).toISOString() };
    save();
    state = initialMonitorState(null, null);

    if (running && !inFlight) schedule(0);
    else emit(); // An in-flight check will be discarded and followed by a fresh one.
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_SNAPSHOT,

    start() {
      if (running) return stop;
      coordinator ??= createTabCoordinator<MonitorSnapshot>();

      if (!loaded) {
        // Show stored history right away, before knowing whether this tab will lead.
        data = loadData(now()).data;
        restoreState();
        loaded = true;
      }

      running = true;
      stopFollowing = coordinator.onMessage(handleMessage);
      releaseLeadership = coordinator.requestLeadership(becomeLeader);
      if (role !== 'leader') {
        coordinator.post({ type: 'hello' });
        emit();
      }
      return stop;
    },

    clearHistory,
    checkNow,

    checkIfOverdue() {
      const { nextCheckAt: due, checking } = snapshot;
      if (!checking && due !== null && due <= now()) checkNow();
    },
  };
}
