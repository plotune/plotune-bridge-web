import { buildPath, formatTick, niceTicks, valueRange, type Path } from './geometry';
import type { Series } from './series';

/** Eight colours that stay apart for common colour-vision differences, with a line pattern and a marker for each, so colour is never the only cue. */
export const SERIES_STYLES: readonly { color: string; dash: number[]; marker: 'circle' | 'square' | 'triangle' | 'diamond' }[] = [
  { color: '#0072b2', dash: [], marker: 'circle' },
  { color: '#c04e00', dash: [7, 3], marker: 'square' },
  { color: '#007a5a', dash: [2, 3], marker: 'triangle' },
  { color: '#a84f86', dash: [9, 3, 2, 3], marker: 'diamond' },
  { color: '#9a6a00', dash: [], marker: 'square' },
  { color: '#2a7fb0', dash: [7, 3], marker: 'triangle' },
  { color: '#5a5a5a', dash: [2, 3], marker: 'diamond' },
  { color: '#000000', dash: [9, 3, 2, 3], marker: 'circle' },
];

export const LANE_HEIGHT = 104;
export const AXIS_HEIGHT = 30;
export const LEFT_GUTTER = 58;
const RIGHT_GUTTER = 10;

export interface DrawInput {
  width: number;
  height: number;
  dpr: number;
  series: readonly Series[];
  t0: number;
  t1: number;
  /** The time under the pointer, when it is over the plot. */
  cursor: number | null;
  /** A range being dragged out to zoom into, in device seconds. */
  selection?: { from: number; to: number } | null;
  colors: { grid: string; text: string; muted: string; background: string };
}

/** Height needed for `lanes` signals. */
export function plotHeight(lanes: number): number {
  return Math.max(1, lanes) * LANE_HEIGHT + AXIS_HEIGHT;
}

export function timeToX(t: number, t0: number, t1: number, width: number): number {
  const plotWidth = width - LEFT_GUTTER - RIGHT_GUTTER;
  return LEFT_GUTTER + ((t - t0) / (t1 - t0 || 1)) * plotWidth;
}

export function xToTime(x: number, t0: number, t1: number, width: number): number {
  const plotWidth = width - LEFT_GUTTER - RIGHT_GUTTER;
  return t0 + ((x - LEFT_GUTTER) / (plotWidth || 1)) * (t1 - t0);
}

function drawMarker(ctx: CanvasRenderingContext2D, kind: (typeof SERIES_STYLES)[number]['marker'], x: number, y: number): void {
  const r = 3.5;
  ctx.beginPath();
  if (kind === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (kind === 'square') ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (kind === 'triangle') {
    ctx.moveTo(x, y - r - 0.5);
    ctx.lineTo(x + r + 0.5, y + r);
    ctx.lineTo(x - r - 0.5, y + r);
    ctx.closePath();
  } else {
    ctx.moveTo(x, y - r - 1);
    ctx.lineTo(x + r + 1, y);
    ctx.lineTo(x, y + r + 1);
    ctx.lineTo(x - r - 1, y);
    ctx.closePath();
  }
  ctx.fill();
}

/** Draws one lane per series on a shared device-clock time axis. Each lane has its own value scale and unit. */
export function drawPlot(ctx: CanvasRenderingContext2D, input: DrawInput): { drawnPoints: number } {
  const { width, height, dpr, series, t0, t1, cursor, selection, colors } = input;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);
  ctx.font = '11px Inter, system-ui, sans-serif';
  const plotWidth = width - LEFT_GUTTER - RIGHT_GUTTER;
  let drawnPoints = 0;
  const timeTicks = niceTicks(t0, t1, Math.max(2, Math.floor(plotWidth / 90)));

  series.forEach((s, lane) => {
    const style = SERIES_STYLES[lane % SERIES_STYLES.length];
    const top = lane * LANE_HEIGHT + 6;
    const bottom = (lane + 1) * LANE_HEIGHT - 6;
    const path: Path = buildPath(s, t0, t1, plotWidth);
    drawnPoints += path.count;
    const range = valueRange([path], t0, t1);
    // Lane frame and horizontal grid.
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(LEFT_GUTTER + 0.5, top + 0.5, plotWidth, bottom - top);
    const yOf = (v: number) => (range ? bottom - ((v - range.min) / (range.max - range.min)) * (bottom - top) : bottom);
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    if (range) {
      for (const tick of niceTicks(range.min, range.max, 3)) {
        const y = Math.round(yOf(tick)) + 0.5;
        if (y < top || y > bottom) continue;
        ctx.strokeStyle = colors.grid;
        ctx.beginPath();
        ctx.moveTo(LEFT_GUTTER, y);
        ctx.lineTo(LEFT_GUTTER + plotWidth, y);
        ctx.stroke();
        ctx.fillText(formatTick(tick), LEFT_GUTTER - 6, y);
      }
    }
    // Lane label: the name is written out, so the line's colour is not the only way to tell signals apart.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    const label = `CAN${s.key.channel} · ${s.key.messageName} · ${s.key.signal}${s.key.unit ? ` [${s.key.unit}]` : ''}`;
    // A backing keeps the name readable where the line passes under it.
    ctx.fillStyle = colors.background;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(LEFT_GUTTER + 4, top + 2, ctx.measureText(label).width + 8, 16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = style.color;
    ctx.fillText(label, LEFT_GUTTER + 8, top + 4);
    ctx.font = '11px Inter, system-ui, sans-serif';
    // The line.
    if (path.count > 0 && range) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(LEFT_GUTTER, top, plotWidth, bottom - top);
      ctx.clip();
      ctx.strokeStyle = style.color;
      ctx.fillStyle = style.color;
      ctx.lineWidth = 1.6;
      ctx.setLineDash(style.dash);
      ctx.beginPath();
      for (let i = 0; i < path.count; i += 1) {
        const x = timeToX(path.t[i], t0, t1, width);
        const y = yOf(path.v[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      drawMarker(ctx, style.marker, timeToX(path.t[path.count - 1], t0, t1, width), yOf(path.v[path.count - 1]));
      ctx.restore();
    } else {
      ctx.fillStyle = colors.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No samples in this window', LEFT_GUTTER + plotWidth / 2, (top + bottom) / 2);
    }
    // The point nearest the cursor.
    if (cursor !== null && range) {
      const near = s.nearest(cursor);
      if (near && near.time >= t0 && near.time <= t1) {
        ctx.fillStyle = style.color;
        drawMarker(ctx, style.marker, timeToX(near.time, t0, t1, width), yOf(near.value));
      }
    }
  });

  // Shared time axis.
  const axisTop = series.length * LANE_HEIGHT;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.strokeStyle = colors.grid;
  for (const tick of timeTicks) {
    const x = Math.round(timeToX(tick, t0, t1, width)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.lineTo(x, axisTop - 6);
    ctx.setLineDash([2, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    const text = `${formatTick(tick)} s`;
    // Keep the label inside the canvas where a tick sits at an edge.
    const half = ctx.measureText(text).width / 2;
    ctx.fillText(text, Math.min(width - half - 1, Math.max(half + 1, x)), axisTop + 4);
  }
  if (selection) {
    const xa = timeToX(Math.min(selection.from, selection.to), t0, t1, width);
    const xb = timeToX(Math.max(selection.from, selection.to), t0, t1, width);
    ctx.fillStyle = colors.text;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(xa, 6, xb - xa, axisTop - 12);
    ctx.globalAlpha = 1;
  }
  if (cursor !== null && cursor >= t0 && cursor <= t1) {
    const x = Math.round(timeToX(cursor, t0, t1, width)) + 0.5;
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.lineTo(x, axisTop - 6);
    ctx.stroke();
  }
  return { drawnPoints };
}
