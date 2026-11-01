import type { Series } from './series';

export interface Path {
  /** Seconds on the device clock. */
  t: Float64Array;
  v: Float64Array;
  count: number;
}

/**
 * The points to draw for a window [t0, t1] on a canvas `width` pixels wide. With few points they are used as they are; with
 * many, every pixel column keeps its first, lowest, highest and last value, so a spike is never lost and the cost depends on
 * the width of the plot, not on the frame rate. The point before the window is included so the line enters from the left edge.
 */
export function buildPath(series: Series, t0: number, t1: number, width: number): Path {
  const from = Math.max(0, series.lowerBound(t0) - 1);
  const to = Math.min(series.length, series.lowerBound(t1 + 1e-9) + 1);
  const n = Math.max(0, to - from);
  if (n === 0) return { t: new Float64Array(0), v: new Float64Array(0), count: 0 };
  const columns = Math.max(1, Math.floor(width));
  if (n <= columns * 2) {
    const t = new Float64Array(n);
    const v = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      t[i] = series.timeAt(from + i);
      v[i] = series.valueAt(from + i);
    }
    return { t, v, count: n };
  }
  const span = t1 - t0 || 1;
  const t = new Float64Array(columns * 4);
  const v = new Float64Array(columns * 4);
  let count = 0;
  let i = from;
  while (i < to) {
    const column = Math.min(columns - 1, Math.max(0, Math.floor(((series.timeAt(i) - t0) / span) * columns)));
    let lo = Infinity;
    let hi = -Infinity;
    const first = series.valueAt(i);
    let last = first;
    const tFirst = series.timeAt(i);
    let tLast = tFirst;
    let tLo = tFirst;
    let tHi = tFirst;
    let j = i;
    for (; j < to; j += 1) {
      const time = series.timeAt(j);
      const c = Math.min(columns - 1, Math.max(0, Math.floor(((time - t0) / span) * columns)));
      if (c !== column) break;
      const value = series.valueAt(j);
      if (value < lo) {
        lo = value;
        tLo = time;
      }
      if (value > hi) {
        hi = value;
        tHi = time;
      }
      last = value;
      tLast = time;
    }
    // In time order inside the column: first, then the extremes, then last.
    const ordered = [
      [tFirst, first],
      [tLo, lo],
      [tHi, hi],
      [tLast, last],
    ].sort((a, b) => a[0] - b[0]);
    for (const [pt, pv] of ordered) {
      t[count] = pt;
      v[count] = pv;
      count += 1;
    }
    i = j;
  }
  return { t: t.subarray(0, count), v: v.subarray(0, count), count };
}

/** Round tick values for an axis: 1, 2 or 5 times a power of ten. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= max + step * 1e-9; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

/** A tick or value as people read it, without floating-point noise. */
export function formatTick(value: number): string {
  if (value === 0) return '0';
  return String(Number(value.toPrecision(7)));
}

/** The value range of the points in a window, padded; a flat line gets a range around it so it is not drawn on an edge. */
export function valueRange(paths: Path[], t0: number, t1: number): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const p of paths) {
    for (let i = 0; i < p.count; i += 1) {
      if (p.t[i] < t0 || p.t[i] > t1) continue;
      if (p.v[i] < min) min = p.v[i];
      if (p.v[i] > max) max = p.v[i];
    }
  }
  if (min === Infinity) return null;
  if (min === max) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.06;
  return { min: min - pad, max: max + pad };
}
