import { Outage } from '@/types';

/**
 * Pure connectivity state machine: no React, no timers, no storage.
 * The runner in lib/connectivity-monitor.ts feeds it check results and
 * persists the events it emits.
 */

export type ConnectionStatus = 'unknown' | 'up' | 'down';

export interface FailureStreak {
  /** Failed checks in a row since the last success (or since the last gap). */
  consecutiveFailures: number;
  /** When the current failure streak began (epoch ms); becomes the outage start time. */
  firstFailureAt: number | null;
  /** True while every failure in the streak happened with the device reporting no network. */
  local: boolean;
}

export interface MonitorState {
  status: ConnectionStatus;
  streak: FailureStreak;
  /** When the most recent check ran (epoch ms). */
  lastCheckAt: number | null;
  currentOutage: Outage | null;
}

export interface MonitorEvent {
  /** 'updated' means an open outage changed, e.g. its cause went from local to ISP. */
  type: 'started' | 'updated' | 'ended';
  outage: Outage;
  /**
   * True when an outage was closed because of a gap in monitoring, not because the
   * connection was seen coming back. Nothing was observed, so nothing to announce.
   */
  gap?: boolean;
}

export interface CheckResult {
  online: boolean;
  /** When the check ran (epoch ms). */
  at: number;
  /** navigator.onLine when the check ran. False means the device itself had no network. */
  deviceOnline?: boolean;
}

export interface MonitorOptions {
  threshold: number;
  intervalMs: number;
  newId: () => string;
  /** ISP name to record on outages that start during this check. */
  isp?: string | null;
}

/**
 * Slack added on top of two check intervals before a pause between checks is
 * treated as "we weren't watching". Covers background-tab timer throttling,
 * which can delay timers by up to about a minute.
 */
export const GAP_TOLERANCE_MS = 60_000;

/** How soon to re-check while a failure streak or an outage is open. */
export const FAST_RETRY_MS = 10_000;

export const EMPTY_STREAK: FailureStreak = Object.freeze({
  consecutiveFailures: 0,
  firstFailureAt: null,
  local: false,
});

export function gapThresholdMs(intervalMs: number): number {
  return 2 * intervalMs + GAP_TOLERANCE_MS;
}

/** True when so much time passed between checks that the app can't have been watching. */
export function isGap(lastCheckAt: number | null, at: number, intervalMs: number): boolean {
  return lastCheckAt !== null && at - lastCheckAt > gapThresholdMs(intervalMs);
}

export function initialMonitorState(
  ongoingOutage: Outage | null,
  lastCheckAt: number | null,
  streak: FailureStreak = EMPTY_STREAK,
): MonitorState {
  return {
    status: ongoingOutage ? 'down' : 'unknown',
    streak,
    lastCheckAt,
    currentOutage: ongoingOutage,
  };
}

/** Delay before the next check: short while the connection is in doubt, the full interval otherwise. */
export function nextCheckDelay(state: MonitorState, intervalMs: number): number {
  const inDoubt = state.streak.consecutiveFailures > 0 || state.currentOutage !== null;
  return inDoubt ? Math.min(FAST_RETRY_MS, intervalMs) : intervalMs;
}

function endOutage(outage: Outage, endMs: number): Outage {
  const startMs = Date.parse(outage.startTime);
  const clampedEnd = Math.max(startMs, endMs);
  return {
    ...outage,
    endTime: new Date(clampedEnd).toISOString(),
    duration: (clampedEnd - startMs) / 1000,
  };
}

/**
 * Applies one check result and returns the next state and any outage events.
 *
 * - An outage starts once `threshold` checks in a row have failed. It's
 *   backdated to the first failed check, not the check that crossed the threshold.
 * - A success ends the open outage at the time of that check.
 * - An outage is 'local' only while every failure in it happened with the device
 *   reporting no network. One failure with the device online makes it 'isp'.
 * - If more than `gapThresholdMs` passed since the previous check (sleep, closed
 *   tab, suspended iPad), only what was observed is recorded. An open outage is
 *   closed at the last check that saw it down, and the failure streak restarts.
 */
export function applyCheck(
  prev: MonitorState,
  { online, at, deviceOnline = true }: CheckResult,
  { threshold, intervalMs, newId, isp = null }: MonitorOptions,
): { state: MonitorState; events: MonitorEvent[] } {
  const events: MonitorEvent[] = [];
  let state = prev;

  if (isGap(state.lastCheckAt, at, intervalMs)) {
    if (state.currentOutage && state.lastCheckAt !== null) {
      events.push({ type: 'ended', outage: endOutage(state.currentOutage, state.lastCheckAt), gap: true });
    }
    state = initialMonitorState(null, state.lastCheckAt);
  }

  if (online) {
    if (state.currentOutage) {
      events.push({ type: 'ended', outage: endOutage(state.currentOutage, at) });
    }
    return {
      state: { status: 'up', streak: EMPTY_STREAK, lastCheckAt: at, currentOutage: null },
      events,
    };
  }

  const local = !deviceOnline;
  const prevStreak = state.streak;
  const streak: FailureStreak = {
    consecutiveFailures: prevStreak.consecutiveFailures + 1,
    firstFailureAt: prevStreak.firstFailureAt ?? at,
    local: prevStreak.consecutiveFailures === 0 ? local : prevStreak.local && local,
  };

  let currentOutage = state.currentOutage;
  if (!currentOutage && streak.consecutiveFailures >= threshold) {
    currentOutage = {
      id: newId(),
      startTime: new Date(streak.firstFailureAt!).toISOString(),
      endTime: null,
      duration: null,
      cause: streak.local ? 'local' : 'isp',
      isp,
    };
    events.push({ type: 'started', outage: currentOutage });
  } else if (currentOutage && currentOutage.cause === 'local' && !local) {
    currentOutage = { ...currentOutage, cause: 'isp' };
    events.push({ type: 'updated', outage: currentOutage });
  }

  return {
    state: {
      // Below the threshold the status stays as it was (still "unknown" until the first success).
      status: currentOutage ? 'down' : state.status,
      streak,
      lastCheckAt: at,
      currentOutage,
    },
    events,
  };
}

/** Replaces the outage with the same id, or appends it. */
export function upsertOutage(outages: Outage[], outage: Outage): Outage[] {
  const index = outages.findIndex(o => o.id === outage.id);
  if (index === -1) return [...outages, outage];
  const next = outages.slice();
  next[index] = outage;
  return next;
}

/**
 * Only the most recent outage can still be open. Earlier records with no end time
 * are phantoms from the old overlapping-check bug, which could log the same outage
 * twice. They would count as growing downtime forever, so drop them.
 */
export function normalizeOutages(outages: Outage[]): Outage[] {
  if (outages.length === 0) return outages;
  const latestStart = Math.max(...outages.map(o => Date.parse(o.startTime)));
  let keptOngoing = false;
  return outages
    .slice()
    .reverse()
    .filter(o => {
      if (o.endTime !== null) return true;
      if (!keptOngoing && Date.parse(o.startTime) === latestStart) {
        keptOngoing = true;
        return true;
      }
      return false;
    })
    .reverse();
}

export function newOutageId(): string {
  // crypto.randomUUID is only available in secure contexts (https or localhost),
  // so fall back when the app is opened over plain http on a LAN address.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `outage-${crypto.randomUUID()}`;
  }
  return `outage-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
