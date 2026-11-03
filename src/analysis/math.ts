// The numbers behind the Analyzer: ranges, ticks, per-pixel reduction and statistics. Pure functions, no drawing.

/** One signal of a recording: sorted times (seconds from the start of the recording) and values. */
export interface SignalData {
  key: string;
  label: string;
  unit: string;
  decimals: number;
  /** A two-state signal, drawn as filled steps on its own strip. */
  bool: boolean;
  t: Float64Array;
  v: Float64Array;
}
export interface RecordingEvent { t: number; label: string; kind: 'info' | 'warn' | 'fault' }
export interface Recording {
  id: string;
  name: string;
  created: number;
  source: 'scope' | 'import' | 'log';
  /** For a log of CAN frames: what it holds. Its signals are decoded from the frames when they are added to a plot. */
  log?: { format: string; frames: number; channels: [number, number][] };
  /** Seconds covered by the recording. */
  duration: number;
  signals: Record<string, SignalData>;
  events: RecordingEvent[];
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The index of the first time >= x (length when none). */
export function lowerBound(t: Float64Array, x: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The value at time `x`: linear between samples for analog signals, the last sample for two-state ones. Null outside the data. */
export function valueAt(sig: SignalData, x: number): number | null {
  const n = sig.t.length;
  if (n === 0 || x < sig.t[0]! || x > sig.t[n - 1]!) return null;
  const i = lowerBound(sig.t, x);
  if (i < n && sig.t[i] === x) return sig.v[i]!;
  const a = i - 1;
  if (a < 0) return sig.v[0]!;
  if (i >= n || sig.bool) return sig.v[a]!;
  const f = (x - sig.t[a]!) / (sig.t[i]! - sig.t[a]!);
  return sig.v[a]! * (1 - f) + sig.v[i]! * f;
}

/** The sample time nearest to `x`, for sample-wise cursors. */
export function nearestSample(sig: SignalData, x: number): number | null {
  const n = sig.t.length;
  if (n === 0) return null;
  const i = lowerBound(sig.t, x);
  let best = -1;
  for (const k of [i - 1, i]) {
    if (k < 0 || k >= n) continue;
    if (best < 0 || Math.abs(sig.t[k]! - x) < Math.abs(sig.t[best]! - x)) best = k;
  }
  return sig.t[best]!;
}

/** The next sample time before or after `x` on this signal, or null at the ends. */
export function stepSample(sig: SignalData, x: number, dir: -1 | 1): number | null {
  const n = sig.t.length;
  const i = lowerBound(sig.t, x);
  if (dir > 0) {
    let k = i;
    while (k < n && sig.t[k]! <= x + 1e-12) k += 1;
    return k < n ? sig.t[k]! : null;
  }
  const k = i - 1;
  return k >= 0 ? sig.t[k]! : null;
}

export interface Columns {
  /** Per pixel column: lowest, highest, first and last value, NaN where the column has no samples. */
  min: Float64Array;
  max: Float64Array;
  first: Float64Array;
  last: Float64Array;
  /** Samples per column on average. Above 2 the signal is drawn as columns, below it as a line. */
  density: number;
}
/** Reduces the samples in [t0, t1] to `width` columns, so drawing costs the width of the plot, not the number of samples. */
export function reduceColumns(sig: SignalData, t0: number, t1: number, width: number): Columns {
  const min = new Float64Array(width).fill(NaN);
  const max = new Float64Array(width).fill(NaN);
  const first = new Float64Array(width).fill(NaN);
  const last = new Float64Array(width).fill(NaN);
  const a = lowerBound(sig.t, t0);
  const b = lowerBound(sig.t, t1);
  const span = t1 - t0;
  for (let i = a; i < b && i < sig.t.length; i += 1) {
    const c = Math.min(width - 1, Math.max(0, Math.floor(((sig.t[i]! - t0) / span) * width)));
    const v = sig.v[i]!;
    if (Number.isNaN(first[c]!)) { first[c] = v; min[c] = v; max[c] = v; }
    else { if (v < min[c]!) min[c] = v; if (v > max[c]!) max[c] = v; }
    last[c] = v;
  }
  return { min, max, first, last, density: width > 0 ? Math.max(0, b - a) / width : 0 };
}

export interface RangeStats { count: number; min: number; max: number; avg: number; std: number }
/** Statistics of the samples in [t0, t1]. Null when the range holds none. */
export function rangeStats(sig: SignalData, t0: number, t1: number): RangeStats | null {
  const a = lowerBound(sig.t, Math.min(t0, t1));
  let n = 0;
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  let sq = 0;
  for (let i = a; i < sig.t.length && sig.t[i]! <= Math.max(t0, t1); i += 1) {
    const v = sig.v[i]!;
    n += 1;
    sum += v;
    sq += v * v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (n === 0) return null;
  const avg = sum / n;
  return { count: n, min: lo, max: hi, avg, std: Math.sqrt(Math.max(0, sq / n - avg * avg)) };
}

/** The value range of the signals in [t0, t1], widened a little so the curve does not touch the edge. */
export function fitRange(sigs: readonly SignalData[], t0: number, t1: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of sigs) {
    const st = rangeStats(s, t0, t1);
    if (!st) continue;
    lo = Math.min(lo, st.min);
    hi = Math.max(hi, st.max);
  }
  if (!Number.isFinite(lo)) return null;
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.06;
  return [lo - pad, hi + pad];
}

/** A round step for about `n` ticks over a span. */
export function niceStep(span: number, n: number): number {
  const raw = span / Math.max(1, n);
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / e;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e;
}
export function ticks(lo: number, hi: number, n: number): { values: number[]; step: number } {
  if (!(hi > lo)) return { values: [lo], step: 1 };
  const step = niceStep(hi - lo, n);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
  return { values: out, step };
}
export const decimalsForStep = (step: number): number => Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));

/** Keeps a time range inside the recording and at least `minWidth` wide. */
export function clampView(view: readonly [number, number], full: readonly [number, number], minWidth: number): [number, number] {
  const total = full[1] - full[0];
  const w = clamp(view[1] - view[0], Math.min(minWidth, total), total);
  const a = clamp(view[0], full[0], full[1] - w);
  return [a, a + w];
}
/** Zooms a range around a time. factor < 1 zooms in. */
export function zoomAbout(view: readonly [number, number], anchor: number, factor: number, full: readonly [number, number], minWidth: number): [number, number] {
  return clampView([anchor - (anchor - view[0]) * factor, anchor + (view[1] - anchor) * factor], full, minWidth);
}
export const panBy = (view: readonly [number, number], delta: number, full: readonly [number, number]): [number, number] => clampView([view[0] + delta, view[1] + delta], full, view[1] - view[0]);

/** A value formatted with the decimals the user chose for the signal. */
export const formatValue = (v: number, decimals: number, bool: boolean): string => (bool ? (v ? 'ON' : 'OFF') : v.toFixed(decimals));
