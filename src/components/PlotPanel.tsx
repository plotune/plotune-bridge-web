import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useDbcAssignments, useDbcRegistry } from '../dbc/context';
import type { DbcRegistry } from '../dbc/registry';
import { readStored, writeStored } from '../lib/storage';
import { visibleCsv } from '../plot/csv';
import { AXIS_HEIGHT, LANE_HEIGHT, LEFT_GUTTER, SERIES_STYLES, drawPlot, plotHeight, xToTime } from '../plot/draw';
import { SeriesStore, signalId, type Series, type SignalKey } from '../plot/series';
import { useHub } from '../state/context';
import { Panel } from './Panel';

export const PLOT_STORAGE_KEY = 'bw.plot';
export const MAX_SIGNALS = SERIES_STYLES.length;
export const WINDOWS = [10, 30, 60, 300] as const;
const PICKER_LIMIT = 60;

const windowLabel = (seconds: number) => (seconds < 60 ? `${seconds} s` : `${seconds / 60} min`);
const formatValue = (value: number) => String(Number(value.toPrecision(7)));

/** The remembered signals, kept only where the loaded databases still define them (names and units come from the database, not the file). */
export function restoreSelection(raw: string | null, registry: DbcRegistry): SignalKey[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = (parsed as { signals?: unknown })?.signals;
    if (!Array.isArray(list)) return [];
    const out: SignalKey[] = [];
    for (const item of list.slice(0, MAX_SIGNALS)) {
      const k = item as Partial<SignalKey>;
      if (!Number.isInteger(k.channel) || !Number.isInteger(k.id) || typeof k.extended !== 'boolean' || typeof k.signal !== 'string') continue;
      const message = registry.message(k.channel as number, k.id as number, k.extended);
      const signal = message?.signals.find((s) => s.name === k.signal);
      if (!message || !signal) continue;
      out.push({ channel: k.channel as number, id: k.id as number, extended: k.extended, signal: signal.name, messageName: message.name, unit: signal.unit });
    }
    return out;
  } catch {
    return [];
  }
}

function SignalPicker({ selection, onChange }: { selection: SignalKey[]; onChange: (next: SignalKey[]) => void }) {
  const assignments = useDbcAssignments();
  const [search, setSearch] = useState('');
  const chosen = new Set(selection.map(signalId));
  const needle = search.trim().toLowerCase();
  const results: SignalKey[] = [];
  let more = false;
  outer: for (const a of assignments) {
    for (const message of a.dbc.messages) {
      for (const signal of message.signals) {
        if (needle && !`can${a.channel} ${message.name} ${signal.name}`.toLowerCase().includes(needle)) continue;
        if (results.length >= PICKER_LIMIT) {
          more = true;
          break outer;
        }
        results.push({ channel: a.channel, id: message.id, extended: message.extended, signal: signal.name, messageName: message.name, unit: signal.unit });
      }
    }
  }
  const full = selection.length >= MAX_SIGNALS;
  return (
    <div className="bw-plot-picker" role="group" aria-label="Choose signals to plot">
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search messages and signals (e.g. EngineSpeed)" aria-label="Search signals" />
      <p className="bw-fine">
        {selection.length} of {MAX_SIGNALS} chosen. Each signal gets its own lane and scale, with the unit from the database.
      </p>
      <ul className="bw-plot-results">
        {results.map((key) => {
          const id = signalId(key);
          const checked = chosen.has(id);
          return (
            <li key={id}>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && full}
                  onChange={(e) => onChange(e.target.checked ? [...selection, key] : selection.filter((s) => signalId(s) !== id))}
                />{' '}
                <span className="bw-mono">CAN{key.channel}</span> · {key.messageName} · <strong>{key.signal}</strong>
                {key.unit ? <span className="bw-muted"> [{key.unit}]</span> : null}
              </label>
            </li>
          );
        })}
      </ul>
      {results.length === 0 && <p className="bw-empty">No signal matches “{search}”.</p>}
      {more && <p className="bw-fine">Only the first {PICKER_LIMIT} are listed. Type more of the name to narrow the list.</p>}
      {full && <p className="bw-fine">The most that can be plotted at once is {MAX_SIGNALS}. Clear one to choose another.</p>}
    </div>
  );
}

function Swatch({ index }: { index: number }) {
  const style = SERIES_STYLES[index % SERIES_STYLES.length];
  return (
    <svg width="34" height="12" aria-hidden="true">
      <line x1="1" y1="6" x2="24" y2="6" stroke={style.color} strokeWidth="2" strokeDasharray={style.dash.join(' ')} />
      <circle cx="29" cy="6" r="3.5" fill={style.color} />
    </svg>
  );
}

export function PlotPanel() {
  const hub = useHub();
  const trace = hub.traceBuffer();
  const registry = useDbcRegistry();
  const assignments = useDbcAssignments();
  const [selection, setSelection] = useState<SignalKey[]>(() => restoreSelection(readStored(PLOT_STORAGE_KEY), registry));
  const [seconds, setSeconds] = useState<number>(30);
  const [paused, setPaused] = useState<{ t1: number } | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [picking, setPicking] = useState(selection.length === 0);
  const [store] = useState(() => new SeriesStore());
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  // Selections the loaded databases no longer define are dropped; the rest is remembered in this browser.
  // `assignments` is the trigger: a database that was removed or replaced may no longer define a chosen signal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const valid = useMemo(() => selection.filter((k) => registry.message(k.channel, k.id, k.extended)?.signals.some((s) => s.name === k.signal)), [selection, registry, assignments]);
  const effective = valid.length === selection.length ? selection : valid;
  const change = (next: SignalKey[]) => {
    setSelection(next);
    writeStored(PLOT_STORAGE_KEY, JSON.stringify({ version: 1, signals: next }));
  };

  // Read the samples that arrived since the last render. A paused plot reads nothing, so what is on screen stays put.
  const series: Series[] = useMemo(() => {
    const list = store.sync(effective);
    if (!paused) store.update(trace, registry, assignments);
    return list;
    // trace.version is the trigger: it changes whenever rows arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, effective, paused, trace, trace.version, registry, assignments]);

  const latest = series.reduce((max, s) => (s.length > 0 ? Math.max(max, s.timeAt(s.length - 1)) : max), 0);
  const t1 = paused ? paused.t1 : Math.max(latest, seconds);
  const t0 = t1 - seconds;
  const height = plotHeight(series.length);

  // The holder only exists once a signal is chosen, so the observer is attached when it appears.
  const hasHolder = series.length > 0;
  useEffect(() => {
    const el = holder.current;
    if (!hasHolder || !el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setWidth(Math.max(320, Math.floor(el.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasHolder]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || series.length === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.floor(width * dpr);
    el.height = Math.floor(height * dpr);
    const css = getComputedStyle(el);
    const started = performance.now();
    const { drawnPoints } = drawPlot(ctx, {
      width,
      height,
      dpr,
      series,
      t0,
      t1,
      cursor,
      colors: { grid: css.getPropertyValue('--color-row-rule').trim() || '#ddd', text: css.getPropertyValue('--color-text').trim() || '#333', muted: css.getPropertyValue('--color-muted').trim() || '#666', background: css.getPropertyValue('--color-panel').trim() || '#fff' },
    });
    // Measured on purpose: the target is that the plot's own drawing stays well inside a display frame.
    el.dataset.drawMs = (performance.now() - started).toFixed(2);
    el.dataset.drawnPoints = String(drawnPoints);
  });

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    setCursor(x >= LEFT_GUTTER ? Math.min(t1, Math.max(t0, xToTime(x, t0, t1, width))) : null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const step = seconds / 40;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setCursor((c) => Math.min(t1, Math.max(t0, (c ?? t1) + (event.key === 'ArrowLeft' ? -step : step))));
    } else if (event.key === 'Escape') setCursor(null);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([visibleCsv(series, t0, t1)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'signals.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const hasData = series.some((s) => s.length > 0);
  return (
    <Panel
      id="plot"
      title="Plot"
      className="bw-panel-plot"
      status={paused ? 'Paused' : series.length === 0 ? 'No signals chosen' : `${series.length} ${series.length === 1 ? 'signal' : 'signals'} · last ${windowLabel(seconds)}`}
      actions={
        <>
          <button type="button" className="bw-button bw-small" aria-expanded={picking} onClick={() => setPicking(!picking)}>
            {picking ? 'Hide signal list' : 'Choose signals'}
          </button>
          <label className="bw-inline-check">
            Show
            <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="Time window">
              {WINDOWS.map((w) => (
                <option key={w} value={w}>{windowLabel(w)}</option>
              ))}
            </select>
          </label>
          <button type="button" className="bw-button bw-small" aria-pressed={paused !== null} disabled={!paused && !hasData} onClick={() => setPaused(paused ? null : { t1 })} title={paused ? 'Follow the newest data again' : 'Freeze the plot; capture goes on'}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="bw-button bw-small" disabled={!hasData} onClick={download} title="Save the samples in the visible window as a CSV file">
            Download CSV
          </button>
        </>
      }
    >
      {picking && <SignalPicker selection={effective} onChange={change} />}
      {series.length === 0 ? (
        <p className="bw-empty">Choose one or more signals from your database to follow them over time.</p>
      ) : (
        <>
          <div ref={holder} className="bw-plot-holder" style={{ minHeight: height }}>
            <canvas
              ref={canvas}
              style={{ width, height }}
              tabIndex={0}
              role="img"
              aria-label={`Plot of ${series.map((s) => s.key.signal).join(', ')} over the last ${windowLabel(seconds)}. The values are in the table below. Arrow keys move the cursor.`}
              onPointerMove={onPointerMove}
              onPointerLeave={() => setCursor(null)}
              onKeyDown={onKeyDown}
              data-testid="plot-canvas"
            />
          </div>
          <p className="bw-fine">
            Time is the device’s own clock in seconds since its first frame, not wall-clock time. Each signal has its own scale; units come from the database.
            {store.missed > 0 ? ` ${store.missed.toLocaleString()} rows left the trace before they were read, so the plot has gaps.` : ''}
          </p>
          <div className="bw-table-wrap">
          <table className="bw-table bw-plot-table" data-testid="plot-table">
            <caption>{cursor === null ? 'Latest value of each plotted signal' : `Value of each plotted signal at ${formatValue(cursor)} s`}</caption>
            <thead>
              <tr>
                <th scope="col">Signal</th>
                <th scope="col">Value</th>
                <th scope="col">Time (s)</th>
                <th scope="col"><span className="bw-sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {series.map((s, i) => {
                const point = s.length === 0 ? null : cursor === null ? { time: s.timeAt(s.length - 1), value: s.valueAt(s.length - 1) } : s.nearest(cursor);
                return (
                  <tr key={signalId(s.key)} data-signal={s.key.signal}>
                    <th scope="row">
                      <Swatch index={i} /> CAN{s.key.channel} · {s.key.messageName} · {s.key.signal}
                    </th>
                    <td className="bw-mono">{point ? `${formatValue(point.value)}${s.key.unit ? ` ${s.key.unit}` : ''}` : 'no data yet'}</td>
                    <td className="bw-mono">{point ? formatValue(Number(point.time.toFixed(6))) : ''}</td>
                    <td>
                      <button type="button" className="bw-button bw-small" aria-label={`Remove ${s.key.signal} from the plot`} onClick={() => change(effective.filter((k) => signalId(k) !== signalId(s.key)))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}
    </Panel>
  );
}

export { LANE_HEIGHT, AXIS_HEIGHT };
