import { Outage } from '@/types';
import { checkConnectivity } from '@/lib/connectivity';
import { CHECK_INTERVAL_MS, FAILURE_THRESHOLD } from '@/lib/config';
import { detectISP } from '@/lib/isp-detection';
import {
  TrackerData,
  claimEpoch,
  clearData,
  emptyData,
  loadData,
  readEpoch,
  saveData,
} from '@/lib/storage';
import { accrueMonitoredTime } from '@/lib/stats';
import { Leadership, TabCoordinator, TabMessage, createTabCoordinator } from '@/lib/tab-coordinator';
import {
  ConnectionStatus,
  MonitorState,
  applyCheck,
  gapThresholdMs,
  initialMonitorState,
  isGap,
  newOutageId,
  nextCheckDelay,
  upsertOutage,
} from '@/lib/monitor';

export type MonitorRole = 'leader' | 'follower';

/**
 * How long to wait after the browser reports the network is back before checking.
 * Requests sent while the network is still coming up often fail (Chrome aborts them
 * with ERR_NETWORK_CHANGED), and one such failure would turn a local outage into an
 * ISP one.
 */
export const RECONNECT_SETTLE_MS = 2000;

export interface MonitorSnapshot {
  /** False until state has been loaded from localStorage on the client. */
  loaded: boolean;
  /** Only the leader tab runs checks; followers show what it sends them. */
  role: MonitorRole;
  /** True once a follower is mirroring another tab (it has heard from the leader). */
  following: boolean;
  /** A follower hasn't heard from the leader in too long, and is taking over. */
  leaderUnresponsive: boolean;
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
  /** Checks within `delayMs`, unless a check is already due sooner. */
  checkSoon: (delayMs: number) => void;
  /** Checks now if the next check is already overdue, e.g. after timers were throttled. */
  checkIfOverdue: () => void;
  /** Deletes an outage that has ended. */
  deleteOutage: (id: string) => void;
  /** Marks an outage that has ended as not a real outage (or unmarks it), leaving it out of stats. */
  setOutageFlagged: (id: string, flagged: boolean) => void;
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
  following: false,
  leaderUnresponsive: false,
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
 * others mirror it over a BroadcastChannel (see lib/tab-coordinator.ts). A
 * follower that stops hearing from the leader takes over.
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
  /** Delay for the check after the one in flight, if one was requested meanwhile. */
  let queuedDelay: number | null = null;
  /** Incremented on clear and on leadership changes, so a check already in flight is discarded. */
  let generation = 0;
  /** This tab's leadership epoch (see lib/storage.ts), or null when tabs can't coordinate. */
  let epoch: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nextCheckAt: number | null = null;
  let ispName: string | null = null;
  let ispRequest: Promise<void> | null = null;
  let stopFollowing: (() => void) | null = null;
  let leadership: Leadership | null = null;

  /** While following: when the leader was last heard from, and whether it's gone quiet. */
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let lastLeaderAt = 0;
  let leaderUnresponsive = false;

  let data: TrackerData = emptyData();
  let state: MonitorState = initialMonitorState(null, null);
  /** The latest snapshot from the leader, shown while this tab is a follower. */
  let remote: MonitorSnapshot | null = null;

  function buildSnapshot(): MonitorSnapshot {
    if (role === 'follower' && remote) {
      return { ...remote, loaded: true, role: 'follower', following: true, leaderUnresponsive };
    }
    return {
      loaded,
      role,
      following: false,
      leaderUnresponsive: role === 'follower' && leaderUnresponsive,
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
    // A leader that was replaced while suspended doesn't broadcast its stale view.
    if (role === 'leader' && !replaced()) coordinator?.post({ type: 'snapshot', snapshot });
  }

  /** Another tab took over checking since this one became leader (see lib/storage.ts). */
  function replaced(): boolean {
    return epoch !== null && readEpoch() > epoch;
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
    // A refresh is already on its way; only a forced one is worth a second request.
    if (ispRequest && !force) return;
    const request = (async () => {
      try {
        const name = await detectIsp({ force });
        if (name && name !== ispName) {
          ispName = name;
          emit();
        }
      } catch (error) {
        console.debug('ISP detection failed:', error);
      }
    })();
    ispRequest = request;
    await request;
    if (ispRequest === request) ispRequest = null;
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

  function startWatchdog() {
    stopWatchdog();
    if (!coordinator?.shared) return;
    lastLeaderAt = now();
    let lastTickAt = lastLeaderAt;
    watchdog = setInterval(() => {
      const tickAt = now();
      // This tick is late, so this tab wasn't running either (the computer slept, or
      // the tab was frozen). Its messages may still be on their way: ask again before
      // concluding anything.
      const slept = isGap(lastTickAt, tickAt, intervalMs);
      lastTickAt = tickAt;
      if (!running || role !== 'follower') return;
      if (slept) {
        lastLeaderAt = tickAt;
        coordinator?.post({ type: 'hello' });
        return;
      }
      // The leader posts a snapshot on every check, so silence this long means it isn't running.
      if (tickAt - lastLeaderAt <= gapThresholdMs(intervalMs)) return;
      if (!leaderUnresponsive) {
        leaderUnresponsive = true;
        emit();
      }
      leadership?.takeOver();
    }, intervalMs);
  }

  function stopWatchdog() {
    if (watchdog !== null) clearInterval(watchdog);
    watchdog = null;
    leaderUnresponsive = false;
  }

  /** Stops checking and writing, because another tab leads now. */
  function stepDown() {
    if (role !== 'leader') return;
    role = 'follower';
    generation += 1;
    epoch = null;
    remote = null;
    cancelTimer();
    if (running) {
      startWatchdog();
      coordinator?.post({ type: 'hello' });
    }
    emit();
  }

  /**
   * True if this tab may write. A leader that finds a newer epoch was replaced while
   * it wasn't running (e.g. suspended), so it steps down instead.
   */
  function canWrite(): boolean {
    if (role !== 'leader') return false;
    if (replaced()) {
      stepDown();
      return false;
    }
    return true;
  }

  function notify(handler: ((outage: Outage) => void) | undefined, outage: Outage) {
    try {
      handler?.(outage);
    } catch (error) {
      console.error('Error in outage handler:', error);
    }
  }

  function record(online: boolean, at: number, deviceIsOnline: boolean) {
    if (!canWrite()) return;
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

    let ended = false;
    for (const event of result.events) {
      if (event.type === 'started') notify(onOutageStarted, event.outage);
      if (event.type !== 'ended') continue;
      ended = true;
      if (!event.gap) notify(onOutageEnded, event.outage);
    }
    // After an outage the connection may have come back on a different ISP (e.g. a
    // failover link), so skip the cache. Otherwise this only fetches once the hour-long
    // cache expires, which keeps a long-running dashboard's ISP name current.
    if (ended) void refreshIsp(true);
    else if (online) void refreshIsp(false);
  }

  async function runCheck() {
    timer = null;
    if (inFlight || !canWrite()) return;

    inFlight = true;
    emit();

    const startedGeneration = generation;
    const at = now();
    const onlineBefore = deviceOnline();
    let online: boolean | null = null;
    try {
      online = await check();
    } catch (error) {
      console.error('Error checking connectivity:', error);
    }
    // If the device lost its network at any point during the check, the failure was local.
    const deviceIsOnline = onlineBefore && deviceOnline();

    inFlight = false;
    const stale = startedGeneration !== generation;
    if (online !== null && !stale && role === 'leader') {
      record(online, at, deviceIsOnline);
    }

    if (running && role === 'leader') {
      const delay = stale ? 0 : Math.min(nextCheckDelay(state, intervalMs), queuedDelay ?? Infinity);
      queuedDelay = null;
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
    stopWatchdog();
    epoch = coordinator?.shared ? claimEpoch() : null;

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
      else if (message.type === 'deleteOutage') deleteOutage(message.id);
      else if (message.type === 'flagOutage') setOutageFlagged(message.id, message.flagged);
    } else if (message.type === 'snapshot') {
      remote = message.snapshot;
      lastLeaderAt = now();
      leaderUnresponsive = false;
      emit();
    }
  }

  function stop() {
    if (!running) return;
    running = false;
    stopFollowing?.();
    stopFollowing = null;
    leadership?.release();
    leadership = null;
    stopWatchdog();
    cancelTimer();
    queuedDelay = null;
    if (role === 'leader') {
      role = 'follower';
      generation += 1;
      epoch = null;
    }
  }

  function checkNow() {
    if (!running) return;
    if (role !== 'leader') {
      coordinator?.post({ type: 'checkNow' });
      return;
    }
    if (inFlight) {
      queuedDelay = 0;
      return;
    }
    schedule(0);
  }

  function checkSoon(delayMs: number) {
    // Followers stay put: the leader tab gets the same network events from the browser.
    if (!running || role !== 'leader') return;
    if (inFlight) {
      queuedDelay = Math.min(queuedDelay ?? Infinity, delayMs);
      return;
    }
    if (nextCheckAt === null || now() + delayMs < nextCheckAt) schedule(delayMs);
  }

  function clearHistory() {
    // Followers, and a leader that just found out it was replaced, pass it on to the leader.
    if (!canWrite()) {
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

  /**
   * Replaces (or, with null, removes) an outage that has ended. The open outage is
   * left alone: it belongs to the state machine until it ends.
   */
  function editOutage(id: string, change: (outage: Outage) => Outage | null) {
    const index = data.outages.findIndex(o => o.id === id);
    if (index === -1 || data.outages[index].endTime === null) return;
    const updated = change(data.outages[index]);
    const outages = updated
      ? data.outages.map((o, i) => (i === index ? updated : o))
      : data.outages.filter((_, i) => i !== index);
    data = { ...data, outages };
    save();
    emit();
  }

  function deleteOutage(id: string) {
    if (!canWrite()) {
      coordinator?.post({ type: 'deleteOutage', id });
      return;
    }
    editOutage(id, () => null);
  }

  function setOutageFlagged(id: string, flagged: boolean) {
    if (!canWrite()) {
      coordinator?.post({ type: 'flagOutage', id, flagged });
      return;
    }
    editOutage(id, outage => {
      const next = { ...outage };
      if (flagged) next.flagged = true;
      else delete next.flagged;
      return next;
    });
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
      leadership = coordinator.requestLeadership({ onAcquired: becomeLeader, onLost: stepDown });
      if (role !== 'leader') {
        startWatchdog();
        coordinator.post({ type: 'hello' });
        emit();
      }
      return stop;
    },

    clearHistory,
    checkNow,
    checkSoon,
    deleteOutage,
    setOutageFlagged,

    checkIfOverdue() {
      const { nextCheckAt: due, checking } = snapshot;
      if (!checking && due !== null && due <= now()) checkNow();
    },
  };
}
