import { Annotation, Outage, OutageCause, OutageEndReason, OutageFailure } from '@/types';
import { MAX_NOTE_LENGTH, sortAnnotations } from '@/lib/annotations';
import { EMPTY_STREAK, FailureStreak, RECENT_LATENCY_COUNT, normalizeOutages } from '@/lib/monitor';

/**
 * All tracker data lives under one versioned localStorage key. Only the tab that
 * runs the checks (see lib/tab-coordinator.ts) writes it; other tabs only read.
 */
export const DATA_KEY = 'isp-tracker-data';
export const DATA_VERSION = 2;

/** Separate keys used by version 1 of the app. Migrated on load, removed on the next save. */
export const LEGACY_KEYS = {
  outages: 'isp-outages',
  trackingStart: 'isp-tracking-start',
  lastCheck: 'isp-last-check',
} as const;

export interface TrackerData {
  version: typeof DATA_VERSION;
  outages: Outage[];
  trackingStartTime: string | null;
  /** When the last check ran (epoch ms), used to detect gaps across reloads. */
  lastCheckAt: number | null;
  /** Milliseconds actually spent monitoring, per local day ('YYYY-MM-DD'). */
  monitoredByDay: Record<string, number>;
  /**
   * The same, per local hour ('YYYY-MM-DDTHH'), for the time-of-day breakdown. Missing in
   * data saved before it was recorded; entries older than MONITORED_HOURS_KEPT_DAYS are dropped.
   */
  monitoredByHour: Record<string, number>;
  /** Monitoring time assumed for history migrated from version 1, which didn't record it. */
  legacyMonitoredMs: number;
  /** In-progress failure streak, so a tab that takes over checking can continue it. */
  streak: FailureStreak;
  /** Response times (ms) of the last few successful checks, for the next outage's "before" figure. */
  recentLatencies: number[];
  /** Notes the user added to the history, oldest first. Missing in data saved before notes existed. */
  annotations: Annotation[];
}

export function emptyData(): TrackerData {
  return {
    version: DATA_VERSION,
    outages: [],
    trackingStartTime: null,
    lastCheckAt: null,
    monitoredByDay: {},
    monitoredByHour: {},
    legacyMonitoredMs: 0,
    streak: EMPTY_STREAK,
    recentLatencies: [],
    annotations: [],
  };
}

const hasWindow = () => typeof window !== 'undefined';

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

const FAILURES: readonly OutageFailure[] = ['all', 'dns', 'mixed'];
const END_REASONS: readonly OutageEndReason[] = ['restored', 'gap'];

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isNumberOrNull(value: unknown): value is number | null {
  return isNonNegativeNumber(value) || value === null;
}

function parseJSON(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Returns a clean copy of the outage, or null if it's too malformed to keep. */
export function validateOutage(value: unknown): Outage | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '' || !isTimestamp(o.startTime)) return null;

  const endTime = isTimestamp(o.endTime) ? o.endTime : null;
  let duration: number | null = null;
  if (endTime !== null) {
    duration = isNonNegativeNumber(o.duration)
      ? o.duration
      : Math.max(0, (Date.parse(endTime) - Date.parse(o.startTime)) / 1000);
  }

  const outage: Outage = { id: o.id, startTime: o.startTime, endTime, duration };
  if (o.cause === 'isp' || o.cause === 'local') outage.cause = o.cause as OutageCause;
  if (isStringOrNull(o.isp)) outage.isp = o.isp;
  if (o.flagged === true) outage.flagged = true;
  if (endTime !== null && isOneOf(o.endReason, END_REASONS)) outage.endReason = o.endReason;
  if (isNonNegativeNumber(o.checkIntervalSeconds)) outage.checkIntervalSeconds = o.checkIntervalSeconds;
  if (isNonNegativeNumber(o.failureThreshold)) outage.failureThreshold = o.failureThreshold;
  if (isOneOf(o.failure, FAILURES)) outage.failure = o.failure;
  if (isTimestamp(o.lastGoodCheckAt) || o.lastGoodCheckAt === null) outage.lastGoodCheckAt = o.lastGoodCheckAt;
  for (const key of ['ipv4', 'ipv6', 'ip', 'asn', 'ispAfter', 'ipv4After', 'ipv6After', 'ipAfter', 'asnAfter'] as const) {
    const value = o[key];
    if (isStringOrNull(value)) outage[key] = value;
  }
  for (const key of ['latencyBeforeMs', 'latencyAfterMs', 'latencySettledMs'] as const) {
    const value = o[key];
    if (isNumberOrNull(value)) outage[key] = value;
  }
  return outage;
}

/**
 * Returns a clean copy of the note (text trimmed and capped at MAX_NOTE_LENGTH), or
 * null if it has no usable id, time or text. Also used on notes coming from the UI or
 * other tabs before they're saved.
 */
export function validateAnnotation(value: unknown): Annotation | null {
  if (!value || typeof value !== 'object') return null;
  const a = value as Record<string, unknown>;
  if (typeof a.id !== 'string' || a.id === '' || !isTimestamp(a.time) || typeof a.text !== 'string') {
    return null;
  }
  const text = a.text.trim().slice(0, MAX_NOTE_LENGTH).trim();
  if (text === '') return null;
  return { id: a.id, time: new Date(a.time).toISOString(), text };
}

function validateAnnotations(value: unknown): Annotation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const annotations: Annotation[] = [];
  for (const item of value) {
    const annotation = validateAnnotation(item);
    if (!annotation || seen.has(annotation.id)) continue;
    seen.add(annotation.id);
    annotations.push(annotation);
  }
  return sortAnnotations(annotations);
}

function validateOutages(value: unknown): Outage[] {
  if (!Array.isArray(value)) return [];
  return normalizeOutages(value.map(validateOutage).filter((o): o is Outage => o !== null));
}

function validateMonitoredTotals(value: unknown, keyPattern: RegExp): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, number> = {};
  for (const [key, ms] of Object.entries(value)) {
    if (keyPattern.test(key) && isNonNegativeNumber(ms)) result[key] = ms;
  }
  return result;
}

function validateStreak(value: unknown): FailureStreak {
  if (!value || typeof value !== 'object') return EMPTY_STREAK;
  const s = value as Record<string, unknown>;
  const consecutiveFailures = isNonNegativeNumber(s.consecutiveFailures)
    ? Math.floor(s.consecutiveFailures)
    : 0;
  if (consecutiveFailures === 0) return EMPTY_STREAK;
  const streak: FailureStreak = {
    consecutiveFailures,
    firstFailureAt: isNonNegativeNumber(s.firstFailureAt) ? s.firstFailureAt : null,
    local: s.local === true,
  };
  if (isOneOf(s.failure, FAILURES)) streak.failure = s.failure;
  if (isNonNegativeNumber(s.lastSuccessAt)) streak.lastSuccessAt = s.lastSuccessAt;
  return streak;
}

function validateLatencies(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isNonNegativeNumber).slice(-RECENT_LATENCY_COUNT);
}

function fromStored(value: Record<string, unknown>): TrackerData {
  return {
    version: DATA_VERSION,
    outages: validateOutages(value.outages),
    trackingStartTime: isTimestamp(value.trackingStartTime) ? value.trackingStartTime : null,
    lastCheckAt: isNonNegativeNumber(value.lastCheckAt) ? value.lastCheckAt : null,
    monitoredByDay: validateMonitoredTotals(value.monitoredByDay, /^\d{4}-\d{2}-\d{2}$/),
    monitoredByHour: validateMonitoredTotals(value.monitoredByHour, /^\d{4}-\d{2}-\d{2}T\d{2}$/),
    legacyMonitoredMs: isNonNegativeNumber(value.legacyMonitoredMs) ? value.legacyMonitoredMs : 0,
    streak: validateStreak(value.streak),
    recentLatencies: validateLatencies(value.recentLatencies),
    annotations: validateAnnotations(value.annotations),
  };
}

function fromLegacy(now: number): TrackerData | null {
  const rawOutages = localStorage.getItem(LEGACY_KEYS.outages);
  const rawStart = localStorage.getItem(LEGACY_KEYS.trackingStart);
  const rawLastCheck = localStorage.getItem(LEGACY_KEYS.lastCheck);
  if (rawOutages === null && rawStart === null && rawLastCheck === null) return null;

  const trackingStartTime = isTimestamp(rawStart) ? rawStart : null;
  const lastCheckAt = isTimestamp(rawLastCheck) ? Date.parse(rawLastCheck) : null;
  // Version 1 assumed monitoring was continuous, so carry that assumption forward
  // up to the last check. Uptime shown before and after the migration then matches.
  const legacyMonitoredMs = trackingStartTime
    ? Math.max(0, (lastCheckAt ?? now) - Date.parse(trackingStartTime))
    : 0;

  return {
    ...emptyData(),
    outages: validateOutages(parseJSON(rawOutages)),
    trackingStartTime,
    lastCheckAt,
    legacyMonitoredMs,
  };
}

/**
 * Reads and validates the tracker data, migrating version 1 data if that's all
 * there is. `changed` is true when the result differs from what's stored (it was
 * migrated or cleaned up) and should be saved by the tab that owns writes.
 */
export function loadData(now: number = Date.now()): { data: TrackerData; changed: boolean } {
  if (!hasWindow()) return { data: emptyData(), changed: false };

  const raw = localStorage.getItem(DATA_KEY);
  const stored = parseJSON(raw);
  if (stored && typeof stored === 'object') {
    const data = fromStored(stored as Record<string, unknown>);
    return { data, changed: JSON.stringify(data) !== raw };
  }

  const legacy = fromLegacy(now);
  if (legacy) return { data: legacy, changed: true };
  return { data: emptyData(), changed: false };
}

export function saveData(data: TrackerData): void {
  if (!hasWindow()) return;
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
  Object.values(LEGACY_KEYS).forEach(key => localStorage.removeItem(key));
}

export function clearData(): void {
  if (!hasWindow()) return;
  localStorage.removeItem(DATA_KEY);
  Object.values(LEGACY_KEYS).forEach(key => localStorage.removeItem(key));
}

/**
 * Leadership epoch: each tab that takes over checking claims the next number. A
 * leader that sees a newer one has been replaced (e.g. it was suspended and another
 * tab took the lock), so it must stop writing. Kept apart from the tracker data so
 * it's cheap to read before every write, and survives clearing history.
 */
export const EPOCH_KEY = 'isp-tracker-leader-epoch';

export function readEpoch(): number {
  if (!hasWindow()) return 0;
  const value = Number(localStorage.getItem(EPOCH_KEY));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function claimEpoch(): number {
  const next = readEpoch() + 1;
  if (hasWindow()) localStorage.setItem(EPOCH_KEY, String(next));
  return next;
}
