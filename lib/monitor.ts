import { Outage } from '@/types';

/**
 * Pure connectivity state machine: no React, no timers, no storage.
 * The runner in lib/connectivity-monitor.ts feeds it check results and
 * persists the events it emits.
 */

export type ConnectionStatus = 'unknown' | 'up' | 'down';

export interface MonitorState {
  status: ConnectionStatus;
  /** Failed checks in a row since the last success (or since the last gap). */
  consecutiveFailures: number;
  /** When the current failure streak began (epoch ms); becomes the outage start time. */
  firstFailureAt: number | null;
  /** When the most recent check ran (epoch ms). */
  lastCheckAt: number | null;
  currentOutage: Outage | null;
}

export type MonitorEvent =
  | { type: 'outageStarted'; outage: Outage }
  | { type: 'outageEnded'; outage: Outage };

export interface CheckResult {
  online: boolean;
  /** When the check ran (epoch ms). */
  at: number;
}

export interface MonitorOptions {
  threshold: number;
  intervalMs: number;
  newId: () => string;
}

/**
 * Slack added on top of two check intervals before a pause between checks is
 * treated as "we weren't watching". Covers background-tab timer throttling,
 * which can delay timers by up to about a minute.
 */
export const GAP_TOLERANCE_MS = 60_000;

export function gapThresholdMs(intervalMs: number): number {
  return 2 * intervalMs + GAP_TOLERANCE_MS;
}

export function initialMonitorState(
  ongoingOutage: Outage | null,
  lastCheckAt: number | null,
): MonitorState {
  return {
    status: ongoingOutage ? 'down' : 'unknown',
    consecutiveFailures: 0,
    firstFailureAt: null,
    lastCheckAt,
    currentOutage: ongoingOutage,
  };
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
 * - If more than `gapThresholdMs` passed since the previous check (sleep, closed
 *   tab, suspended iPad), only what was observed is recorded. An open outage is
 *   closed at the last check that saw it down, and the failure streak restarts.
 */
export function applyCheck(
  prev: MonitorState,
  { online, at }: CheckResult,
  { threshold, intervalMs, newId }: MonitorOptions,
): { state: MonitorState; events: MonitorEvent[] } {
  const events: MonitorEvent[] = [];
  let state = prev;

  if (state.lastCheckAt !== null && at - state.lastCheckAt > gapThresholdMs(intervalMs)) {
    if (state.currentOutage) {
      events.push({ type: 'outageEnded', outage: endOutage(state.currentOutage, state.lastCheckAt) });
    }
    state = { ...initialMonitorState(null, state.lastCheckAt) };
  }

  if (online) {
    if (state.currentOutage) {
      events.push({ type: 'outageEnded', outage: endOutage(state.currentOutage, at) });
    }
    return {
      state: {
        status: 'up',
        consecutiveFailures: 0,
        firstFailureAt: null,
        lastCheckAt: at,
        currentOutage: null,
      },
      events,
    };
  }

  const consecutiveFailures = state.consecutiveFailures + 1;
  const firstFailureAt = state.firstFailureAt ?? at;
  let currentOutage = state.currentOutage;

  if (!currentOutage && consecutiveFailures >= threshold) {
    currentOutage = {
      id: newId(),
      startTime: new Date(firstFailureAt).toISOString(),
      endTime: null,
      duration: null,
    };
    events.push({ type: 'outageStarted', outage: currentOutage });
  }

  return {
    state: {
      // Below the threshold the status stays as it was (still "unknown" until the first success).
      status: currentOutage ? 'down' : state.status,
      consecutiveFailures,
      firstFailureAt,
      lastCheckAt: at,
      currentOutage,
    },
    events,
  };
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
