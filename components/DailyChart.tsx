'use client';

import { KeyboardEvent, useRef, useState } from 'react';
import { DayStats } from '@/lib/stats';
import { formatDurationFromSeconds } from '@/lib/format';

interface DailyChartProps {
  days: DayStats[];
}

const TICK_STEPS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

/** Y-axis maximum and clean ticks (at most 4 steps), with headroom for the peak label. */
export function axisScale(peakSeconds: number): { max: number; ticks: number[] } {
  if (peakSeconds <= 0) return { max: 60, ticks: [0] };
  const target = peakSeconds * 1.15;
  const step = TICK_STEPS.find(s => target / s <= 4) ?? 86400 * Math.ceil(target / 86400 / 4);
  const max = step * Math.ceil(target / step);
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  return { max, ticks };
}

/** Same duration format as the rest of the app, so ticks read "30m, 1h, 1h 30m". */
const tickLabel = (seconds: number) => (seconds === 0 ? '0' : formatDurationFromSeconds(seconds));

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const longDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export const isNotMonitored = (day: DayStats) =>
  day.monitoredSeconds === 0 && day.ispSeconds === 0 && day.localSeconds === 0;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describe(day: DayStats): string {
  if (isNotMonitored(day)) return `${longDate(day.start)}: not monitored`;
  const parts = [`${formatDurationFromSeconds(day.ispSeconds)} ISP downtime`];
  if (day.localSeconds > 0) parts.push(`${formatDurationFromSeconds(day.localSeconds)} local network`);
  parts.push(plural(day.outages, 'outage'));
  return `${longDate(day.start)}: ${parts.join(', ')}`;
}

function ReadoutValue({ swatch, value, label }: { swatch: string; value: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`inline-block h-0.5 w-3 rounded-full ${swatch}`} />
      <strong className="font-semibold text-gray-900">{value}</strong>
      <span className="text-gray-500">{label}</span>
    </span>
  );
}

/**
 * Downtime per day as stacked columns: ISP downtime at the baseline, local-network
 * downtime above it in de-emphasis gray. Days the app wasn't running get a ring on
 * the baseline instead of a bar, so "not monitored" never reads as "no downtime".
 * Tapping, clicking or arrowing to a day pins its numbers in the readout below.
 */
export default function DailyChart({ days }: DailyChartProps) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  if (days.length === 0) return null;

  const lastIndex = days.length - 1;
  // Defaults to today, and falls back to it if the selected day scrolls out of the window.
  const selectedIndex = days.findIndex(d => d.day === selectedDay);
  const activeKey = days[selectedIndex === -1 ? lastIndex : selectedIndex].day;
  const shown = days.find(d => d.day === (hoveredDay ?? activeKey)) ?? days[lastIndex];

  const totals = days.map(d => d.ispSeconds + d.localSeconds);
  const peak = Math.max(0, ...totals);
  const peakIndex = peak > 0 ? totals.lastIndexOf(peak) : -1;
  const { max, ticks } = axisScale(peak);
  const pct = (seconds: number) => (seconds / max) * 100;
  const columns = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = days.findIndex(d => d.day === activeKey);
    const next = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: lastIndex,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const index = Math.max(0, Math.min(lastIndex, next));
    setSelectedDay(days[index].day);
    buttons.current[index]?.focus();
  };

  return (
    <figure>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
        <figcaption>
          <h2 className="text-xl md:text-2xl font-bold">Daily Downtime</h2>
          <p className="text-sm text-gray-500">Last {days.length} days · tap a day for details</p>
        </figcaption>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600" aria-label="Legend">
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 rounded-sm bg-viz-series-1" />
            ISP downtime
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 rounded-sm bg-viz-deemphasis" />
            Local network
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full border-2 border-viz-baseline" />
            Not monitored
          </li>
        </ul>
      </div>

      <div className="relative mt-6 h-44">
        <div className="absolute inset-y-0 left-12 right-0">
          {ticks.filter(t => t > 0).map(t => (
            <div
              key={t}
              aria-hidden="true"
              className="absolute inset-x-0 border-t border-viz-grid"
              style={{ bottom: `${pct(t)}%` }}
            >
              <span className="absolute right-full mr-2 -translate-y-1/2 whitespace-nowrap text-xs text-viz-muted tabular-nums">
                {tickLabel(t)}
              </span>
            </div>
          ))}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 border-t border-viz-baseline">
            <span className="absolute right-full mr-2 -translate-y-1/2 whitespace-nowrap text-xs text-viz-muted tabular-nums">0</span>
          </div>

          {peak === 0 && (
            <p className="absolute inset-x-0 top-1/3 text-center text-sm text-gray-400">
              No downtime in the last {days.length} days
            </p>
          )}

          <div
            role="radiogroup"
            aria-label="Downtime per day"
            className="absolute inset-0 grid"
            style={columns}
            onKeyDown={onKeyDown}
            onPointerLeave={() => setHoveredDay(null)}
          >
            {days.map((day, i) => {
              const total = totals[i];
              const isActive = day.day === activeKey;
              const segments = [
                { key: 'local', seconds: day.localSeconds, color: 'bg-viz-deemphasis' },
                { key: 'isp', seconds: day.ispSeconds, color: 'bg-viz-series-1' },
              ].filter(s => s.seconds > 0);
              return (
                <button
                  key={day.day}
                  ref={el => {
                    buttons.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={describe(day)}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setSelectedDay(day.day)}
                  onPointerEnter={event => {
                    if (event.pointerType === 'mouse') setHoveredDay(day.day);
                  }}
                  className={`relative flex h-full flex-col items-center justify-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    isActive ? 'bg-gray-100' : 'hover:bg-gray-50'
                  }`}
                >
                  {i === peakIndex && (
                    <span
                      className="pointer-events-none absolute whitespace-nowrap text-xs font-medium text-gray-700"
                      style={{ bottom: `calc(${pct(total)}% + 4px)` }}
                    >
                      {formatDurationFromSeconds(total)}
                    </span>
                  )}
                  {segments.length > 0 ? (
                    <span
                      className="flex w-full max-w-6 flex-col gap-[2px] px-px"
                      style={{ height: `${pct(total)}%`, minHeight: segments.length * 2 + (segments.length - 1) * 2 }}
                    >
                      {segments.map((segment, s) => (
                        <span
                          key={segment.key}
                          className={`${segment.color} min-h-[2px] ${s === 0 ? 'rounded-t-[4px]' : ''}`}
                          style={{ flexGrow: segment.seconds, flexBasis: 0 }}
                        />
                      ))}
                    </span>
                  ) : isNotMonitored(day) ? (
                    <span
                      aria-hidden="true"
                      className="size-2 translate-y-1/2 rounded-full border-2 border-viz-baseline bg-white"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="ml-12 mt-3 grid text-xs text-viz-muted" style={columns} aria-hidden="true">
        {days.map((day, i) => (
          <span key={day.day} className="justify-self-center whitespace-nowrap">
            {(lastIndex - i) % 7 === 0 ? (i === lastIndex ? 'Today' : shortDate(day.start)) : ''}
          </span>
        ))}
      </div>

      <div
        className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-gray-100 pt-3 text-sm"
        aria-live="polite"
      >
        <span className="font-medium text-gray-800">{longDate(shown.start)}</span>
        {isNotMonitored(shown) ? (
          <span className="text-gray-500">Not monitored</span>
        ) : (
          <>
            <ReadoutValue
              swatch="bg-viz-series-1"
              value={formatDurationFromSeconds(shown.ispSeconds)}
              label="ISP downtime"
            />
            {shown.localSeconds > 0 && (
              <ReadoutValue
                swatch="bg-viz-deemphasis"
                value={formatDurationFromSeconds(shown.localSeconds)}
                label="local network"
              />
            )}
            <span>
              <strong className="font-semibold text-gray-900">{shown.outages}</strong>{' '}
              <span className="text-gray-500">{shown.outages === 1 ? 'outage' : 'outages'}</span>
            </span>
            <span className="text-gray-500">
              monitored {formatDurationFromSeconds(shown.monitoredSeconds)}
            </span>
          </>
        )}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-gray-500">Show as table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="py-1 pr-4 font-medium">Day</th>
                <th className="py-1 pr-4 font-medium">ISP downtime</th>
                <th className="py-1 pr-4 font-medium">Local network</th>
                <th className="py-1 pr-4 font-medium">Outages</th>
                <th className="py-1 font-medium">Monitored</th>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              {[...days].reverse().map(day => (
                <tr key={day.day} className="border-t border-gray-100">
                  <td className="py-1 pr-4">{longDate(day.start)}</td>
                  {isNotMonitored(day) ? (
                    <td className="py-1 text-gray-400" colSpan={4}>Not monitored</td>
                  ) : (
                    <>
                      <td className="py-1 pr-4">{formatDurationFromSeconds(day.ispSeconds)}</td>
                      <td className="py-1 pr-4">{formatDurationFromSeconds(day.localSeconds)}</td>
                      <td className="py-1 pr-4">{day.outages}</td>
                      <td className="py-1">{formatDurationFromSeconds(day.monitoredSeconds)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
