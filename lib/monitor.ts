import { CheckFailure, Outage, OutageEndReason, OutageFailure } from '@/types';

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
  /** How the streak's checks failed, once one has reported it. */
  failure?: OutageFailure;
  /** When the successful check just before the streak ran (epoch ms), if there was one. */
  lastSuccessAt?: number;
}

/** Response times being collected for an outage that just ended, for its settled figure. */
export interface Settling {
  outageId: string;
  samples: number[];
}

export interface MonitorState {
  status: ConnectionStatus;
  streak: FailureStreak;
  /** When the most recent check ran (epoch ms). */
  lastCheckAt: number | null;
  currentOutage: Outage | null;
  /** Response times (ms) of the last few successful checks, oldest first. */
  recentLatencies: number[];
  /** When the last outage ended with the connection restored (epoch ms). Fast checks continue for a while after it. */
  recoveredAt: number | null;
  /** The outage that just ended, while the checks after it are timed for its settled response time. */
  settling: Settling | null;
}

export interface MonitorEvent {
  /** 'updated' means an open outage changed, e.g. its cause went from local to ISP, or its failure to 'mixed'. */
  type: 'started' | 'updated' | 'ended';
  outage: Outage;
  /**
   * True when an outage was closed because of a gap in monitoring, not because the
   * connection was seen coming back. Nothing was observed, so nothing to announce.
   */
  gap?: boolean;
}

/** A change to an outage that has already ended, to merge into the stored record. */
export interface OutageAmendment {
  id: string;
  patch: Partial<Outage>;
}

export interface CheckResult {
  online: boolean;
  /** When the check ran (epoch ms). */
  at: number;
  /** navigator.onLine when the check ran. False means the device itself had no network. */
  deviceOnline?: boolean;
  /** How a failed check failed. */
  failure?: CheckFailure;
  /** Fastest successful response (ms), if anything answered. */
  latencyMs?: number | null;
}

export interface MonitorOptions {
  threshold: number;
  intervalMs: number;
  newId: () => string;
  /** ISP name, public IPv4 and IPv6 addresses and ASN to record on outages that start during this check. */
  isp?: string | null;
  ipv4?: string | null;
  ipv6?: string | null;
  asn?: string | null;
}

/**
 * Slack added on top of two check intervals before a pause between checks is
 * treated as "we weren't watching". Covers background-tab timer throttling,
 * which can delay timers by up to about a minute.
 */
export const GAP_TOLERANCE_MS = 60_000;

/** How soon to re-check while a failure streak or an outage is open. */
export const FAST_RETRY_MS = 10_000;

/** How many successful checks' response times to keep, for an outage's "before" figure. */
export const RECENT_LATENCY_COUNT = 5;

/**
 * How long checks stay fast after an outage ends. A connection that just came back
 * often drops again, and at the full interval those drops would be timed a minute late.
 */
export const RECOVERY_WATCH_MS = 3 * 60_000;

/** Successful checks after the one that saw the connection come back, for an outage's settled response time. */
export const SETTLED_SAMPLE_COUNT = 3;

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
  recentLatencies: number[] = [],
): MonitorState {
  return {
    status: ongoingOutage ? 'down' : 'unknown',
    streak,
    lastCheckAt,
    currentOutage: ongoingOutage,
    recentLatencies,
    recoveredAt: null,
    settling: null,
  };
}

/**
 * Delay between the start of one check and the next: short while the connection is
 * in doubt or just came back, the full interval otherwise.
 */
export function nextCheckDelay(state: MonitorState, intervalMs: number): number {
  const inDoubt = state.streak.consecutiveFailures > 0 || state.currentOutage !== null;
  const recovering =
    state.recoveredAt !== null &&
    state.lastCheckAt !== null &&
    state.lastCheckAt - state.recoveredAt < RECOVERY_WATCH_MS;
  return inDoubt || recovering ? Math.min(FAST_RETRY_MS, intervalMs) : intervalMs;
}

function endOutage(
  outage: Outage,
  endMs: number,
  endReason: OutageEndReason,
  latencyAfterMs: number | null = null,
): Outage {
  const startMs = Date.parse(outage.startTime);
  const clampedEnd = Math.max(startMs, endMs);
  const ended: Outage = {
    ...outage,
    endTime: new Date(clampedEnd).toISOString(),
    duration: (clampedEnd - startMs) / 1000,
    endReason,
  };
  if (endReason === 'restored') ended.latencyAfterMs = latencyAfterMs;
  return ended;
}

/** Combines how an outage's checks have failed so far with how the latest one did. */
function mergeFailure(sofar: OutageFailure | undefined, latest: CheckFailure | undefined): OutageFailure | undefined {
  if (!latest) return sofar;
  if (!sofar) return latest;
  return sofar === latest ? sofar : 'mixed';
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Applies one check result and returns the next state and any outage events.
 *
 * - An outage starts once `threshold` checks in a row have failed. It's
 *   backdated to the first failed check, not the check that crossed the threshold.
 * - A success ends the open outage at the time of that check.
 * - An outage is 'local' only while every failure in it happened with the device
 *   reporting no network. One failure with the device online makes it 'isp'.
 * - Its `failure` becomes 'mixed' once both DNS-only and total failures were seen.
 * - If more than `gapThresholdMs` passed since the previous check (sleep, closed
 *   tab, suspended iPad), only what was observed is recorded. An open outage is
 *   closed at the last check that saw it down, and the failure streak restarts.
 * - The outage records when the last successful check before it ran, since it
 *   began somewhere between then and its first failed check.
 * - After an outage ends, the response times of the next few successful checks give
 *   its settled response time, returned as an amendment to the ended outage. A failed
 *   check before then cancels it.
 */
export function applyCheck(
  prev: MonitorState,
  { online, at, deviceOnline = true, failure, latencyMs = null }: CheckResult,
  { threshold, intervalMs, newId, isp = null, ipv4 = null, ipv6 = null, asn = null }: MonitorOptions,
): { state: MonitorState; events: MonitorEvent[]; amendments: OutageAmendment[] } {
  const events: MonitorEvent[] = [];
  const amendments: OutageAmendment[] = [];
  let state = prev;

  if (isGap(state.lastCheckAt, at, intervalMs)) {
    if (state.currentOutage && state.lastCheckAt !== null) {
      events.push({ type: 'ended', outage: endOutage(state.currentOutage, state.lastCheckAt, 'gap'), gap: true });
    }
    state = initialMonitorState(null, state.lastCheckAt);
  }

  if (online) {
    let { recoveredAt, settling } = state;
    if (state.currentOutage) {
      events.push({ type: 'ended', outage: endOutage(state.currentOutage, at, 'restored', latencyMs) });
      recoveredAt = at;
      settling = { outageId: state.currentOutage.id, samples: [] };
    } else if (settling && latencyMs !== null) {
      const samples = [...settling.samples, latencyMs];
      if (samples.length >= SETTLED_SAMPLE_COUNT) {
        amendments.push({ id: settling.outageId, patch: { latencySettledMs: median(samples) } });
        settling = null;
      } else {
        settling = { ...settling, samples };
      }
    }
    const recentLatencies =
      latencyMs === null
        ? state.recentLatencies
        : [...state.recentLatencies, latencyMs].slice(-RECENT_LATENCY_COUNT);
    return {
      state: { status: 'up', streak: EMPTY_STREAK, lastCheckAt: at, currentOutage: null, recentLatencies, recoveredAt, settling },
      events,
      amendments,
    };
  }

  const local = !deviceOnline;
  const prevStreak = state.streak;
  const streak: FailureStreak = {
    consecutiveFailures: prevStreak.consecutiveFailures + 1,
    firstFailureAt: prevStreak.firstFailureAt ?? at,
    local: prevStreak.consecutiveFailures === 0 ? local : prevStreak.local && local,
  };
  const streakFailure = mergeFailure(prevStreak.consecutiveFailures === 0 ? undefined : prevStreak.failure, failure);
  if (streakFailure) streak.failure = streakFailure;
  // After a gap the status is back to unknown, so an old success isn't mistaken for the last one.
  const lastSuccessAt =
    prevStreak.consecutiveFailures === 0
      ? (state.status === 'up' ? state.lastCheckAt : null)
      : (prevStreak.lastSuccessAt ?? null);
  if (lastSuccessAt !== null) streak.lastSuccessAt = lastSuccessAt;

  let currentOutage = state.currentOutage;
  if (!currentOutage && streak.consecutiveFailures >= threshold) {
    currentOutage = {
      id: newId(),
      startTime: new Date(streak.firstFailureAt!).toISOString(),
      endTime: null,
      duration: null,
      cause: streak.local ? 'local' : 'isp',
      lastGoodCheckAt: lastSuccessAt !== null ? new Date(lastSuccessAt).toISOString() : null,
      isp,
      ipv4,
      ipv6,
      asn,
      checkIntervalSeconds: intervalMs / 1000,
      failureThreshold: threshold,
      latencyBeforeMs: median(state.recentLatencies),
    };
    if (streak.failure) currentOutage.failure = streak.failure;
    events.push({ type: 'started', outage: currentOutage });
  } else if (currentOutage) {
    const next: Outage = { ...currentOutage };
    if (next.cause === 'local' && !local) next.cause = 'isp';
    const outageFailure = mergeFailure(next.failure, failure);
    if (outageFailure) next.failure = outageFailure;
    if (next.cause !== currentOutage.cause || next.failure !== currentOutage.failure) {
      currentOutage = next;
      events.push({ type: 'updated', outage: currentOutage });
    }
  }

  return {
    state: {
      // Below the threshold the status stays as it was (still "unknown" until the first success).
      status: currentOutage ? 'down' : state.status,
      streak,
      lastCheckAt: at,
      currentOutage,
      recentLatencies: state.recentLatencies,
      recoveredAt: state.recoveredAt,
      // The connection dropped again, so it hasn't settled.
      settling: null,
    },
    events,
    amendments,
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
