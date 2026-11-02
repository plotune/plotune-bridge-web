// Drawing and hit testing of the Analyzer's plot area on one canvas: strips with their y axes, an event strip, the shared time axis,
// cursors, and a time slider under it all. The geometry is computed first so pointer handling and drawing agree.
import { SERIES_STYLES } from '../plot/draw';
import { NO_AXIS, stripAxes, type AnalyzerConfig, type SigCfg } from './model';
import { decimalsForStep, reduceColumns, ticks, valueAt, type Recording, type SignalData } from './math';

export const AXIS_WIDTH = 58;
export const TOP = 38;
export const STRIP_GAP = 6;
export const BOOL_HEIGHT = 46;
export const EVENT_HEIGHT = 30;
export const SLIDER_HEIGHT = 40;
export const TIME_AXIS_HEIGHT = 20;
const RIGHT = 12;

export interface StripGeo { id: string; kind: 'analog' | 'bool'; axes: string[]; y0: number; y1: number }
export interface Geometry {
  width: number;
  height: number;
  px0: number;
  px1: number;
  strips: StripGeo[];
  events: { y0: number; y1: number } | null;
  time: { y0: number; y1: number };
  slider: { y0: number; y1: number };
}

export function layout(cfg: AnalyzerConfig, rec: Recording | null, width: number, height: number): Geometry {
  const axisCount = Math.min(4, Math.max(1, ...cfg.strips.filter((s) => s.kind === 'analog').map((s) => stripAxes(cfg, s.id).length)));
  const px0 = axisCount * AXIS_WIDTH + 4;
  const px1 = Math.max(px0 + 40, width - RIGHT);
  const hasEvents = !!rec && rec.events.length > 0;
  const fixed = TOP + SLIDER_HEIGHT + TIME_AXIS_HEIGHT + (hasEvents ? EVENT_HEIGHT + STRIP_GAP : 0) + cfg.strips.filter((s) => s.kind === 'bool').length * BOOL_HEIGHT + cfg.strips.length * STRIP_GAP;
  const analog = cfg.strips.filter((s) => s.kind === 'analog');
  const weights = analog.reduce((a, s) => a + s.weight, 0) || 1;
  const room = Math.max(60, height - fixed);
  let y = TOP;
  const strips = cfg.strips.map((s): StripGeo => {
    const h = s.kind === 'bool' ? BOOL_HEIGHT : (room * s.weight) / weights;
    const g: StripGeo = { id: s.id, kind: s.kind, axes: stripAxes(cfg, s.id), y0: y, y1: y + h };
    y += h + STRIP_GAP;
    return g;
  });
  const events = hasEvents ? { y0: y, y1: y + EVENT_HEIGHT } : null;
  if (events) y += EVENT_HEIGHT + STRIP_GAP;
  return { width, height, px0, px1, strips, events, time: { y0: y, y1: y + TIME_AXIS_HEIGHT }, slider: { y0: height - SLIDER_HEIGHT + 4, y1: height - 4 } };
}

export const timeToX = (g: Geometry, view: readonly [number, number], t: number): number => g.px0 + ((t - view[0]) / (view[1] - view[0])) * (g.px1 - g.px0);
export const xToTime = (g: Geometry, view: readonly [number, number], x: number): number => view[0] + ((x - g.px0) / (g.px1 - g.px0)) * (view[1] - view[0]);
export const valueToY = (s: { y0: number; y1: number }, min: number, max: number, v: number): number => s.y1 - 4 - ((v - min) / (max - min)) * (s.y1 - s.y0 - 8);
export const yToValue = (s: { y0: number; y1: number }, min: number, max: number, y: number): number => min + ((s.y1 - 4 - y) / (s.y1 - s.y0 - 8)) * (max - min);
const boolY = (s: { y0: number; y1: number }, v: number): number => s.y1 - 6 - v * (s.y1 - s.y0 - 14);

export type Hit =
  | { region: 'none' }
  | { region: 'plot'; strip: StripGeo | null; x: number; y: number }
  | { region: 'axis'; strip: StripGeo; axis: string }
  | { region: 'cursor'; which: 'a' | 'b' }
  | { region: 'event'; index: number }
  | { region: 'slider'; part: 'left' | 'right' | 'window' | 'track' };

export function hitTest(g: Geometry, cfg: AnalyzerConfig, rec: Recording, view: readonly [number, number], x: number, y: number): Hit {
  const full = rec.duration || 1;
  const sx = (t: number) => g.px0 + (t / full) * (g.px1 - g.px0);
  if (y >= g.slider.y0 && y <= g.slider.y1 && x >= g.px0 && x <= g.px1) {
    const a = sx(view[0]);
    const b = sx(view[1]);
    return { region: 'slider', part: Math.abs(x - a) < 7 ? 'left' : Math.abs(x - b) < 7 ? 'right' : x > a && x < b ? 'window' : 'track' };
  }
  for (const w of ['a', 'b'] as const) {
    const c = cfg.cur[w];
    if (c && Math.abs(x - timeToX(g, view, c.t)) < 6 && y > TOP - 4 && y < g.time.y0) return { region: 'cursor', which: w };
  }
  for (const s of g.strips) {
    if (y < s.y0 || y > s.y1) continue;
    if (x < g.px0) {
      if (s.kind === 'bool' || s.axes.length === 0) return { region: 'none' };
      const i = Math.min(s.axes.length - 1, Math.max(0, Math.floor((g.px0 - 4 - x) / AXIS_WIDTH)));
      return { region: 'axis', strip: s, axis: s.axes[i]! };
    }
    if (x <= g.px1) return { region: 'plot', strip: s, x, y };
  }
  if (g.events && y >= g.events.y0 && y <= g.events.y1 && x >= g.px0 && x <= g.px1) {
    const i = rec.events.findIndex((e) => Math.abs(timeToX(g, view, e.t) - x) < 8);
    if (i >= 0) return { region: 'event', index: i };
  }
  if (x >= g.px0 && x <= g.px1 && y > TOP && y < g.time.y1) return { region: 'plot', strip: null, x, y };
  return { region: 'none' };
}

export interface Theme { line: string; grid: string; text: string; muted: string; panel: string; paper: string; accent: string; accent2: string; bad: string; warn: string }
export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { line: v('--color-border', '#d2d5ce'), grid: v('--color-row-rule-soft', '#edf0f1'), text: v('--color-ink', '#1c242b'), muted: v('--color-muted', '#526067'), panel: v('--color-panel', '#ffffff'), paper: v('--color-paper', '#f5f5f7'), accent: v('--color-accent-bright', '#5b62a7'), accent2: v('--color-accent', '#4a519a'), bad: v('--text-bad', '#a8261f'), warn: v('--text-warn', '#7a5200') };
}
export const styleOf = (s: SigCfg) => SERIES_STYLES[(s.color - 1) % SERIES_STYLES.length]!;

export interface DrawState {
  hoverX: number | null;
  rubber: { x0: number; y0: number; x1: number; y1: number } | null;
  focusStrip: string | null;
  selected: ReadonlySet<string>;
}

export function drawAnalyzer(ctx: CanvasRenderingContext2D, g: Geometry, cfg: AnalyzerConfig, rec: Recording, view: readonly [number, number], st: DrawState, th: Theme): void {
  ctx.clearRect(0, 0, g.width, g.height);
  const span = g.px1 - g.px0;
  ctx.font = '11px "Roboto Mono", ui-monospace, monospace';
  if (cfg.sigs.length === 0) {
    ctx.fillStyle = th.muted;
    ctx.textAlign = 'center';
    ctx.font = '500 14px Inter, system-ui, sans-serif';
    ctx.fillText('Add signals with “Signal”, or drag them here from the Signals list', g.width / 2, g.height / 2 - 8);
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText('Strips keep unrelated signals apart. Signals with the same unit can share an axis.', g.width / 2, g.height / 2 + 12);
    return;
  }
  const xt = ticks(view[0], view[1], Math.max(3, span / 110));
  const tdec = decimalsForStep(xt.step);
  const sigData = (s: SigCfg): SignalData | undefined => rec.signals[s.key];

  for (const sg of g.strips) {
    ctx.fillStyle = th.panel;
    ctx.fillRect(g.px0, sg.y0, span, sg.y1 - sg.y0);
    ctx.strokeStyle = th.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(g.px0 + 0.5, sg.y0 + 0.5, span - 1, sg.y1 - sg.y0 - 1);
    ctx.strokeStyle = th.grid;
    for (const t of xt.values) { const x = Math.round(timeToX(g, view, t)) + 0.5; ctx.beginPath(); ctx.moveTo(x, sg.y0); ctx.lineTo(x, sg.y1); ctx.stroke(); }
    if (st.focusStrip === sg.id) { ctx.fillStyle = th.accent; ctx.fillRect(g.px0 - 2, sg.y0, 2, sg.y1 - sg.y0); }
    const here = cfg.sigs.filter((s) => s.strip === sg.id);
    if (sg.kind === 'bool') {
      const s = here[0];
      if (!s) continue;
      ctx.fillStyle = th.muted;
      ctx.textAlign = 'right';
      ctx.fillText((sigData(s)?.label ?? s.key).slice(0, 18), g.px0 - 6, sg.y0 + 14);
      ctx.fillText('1', g.px0 - 6, sg.y0 + 26);
      ctx.fillText('0', g.px0 - 6, sg.y1 - 4);
      drawSignal(ctx, g, cfg, rec, view, s, sg, th);
      continue;
    }
    sg.axes.forEach((aid, ai) => {
      const a = cfg.axes[aid]!;
      const on = here.filter((s) => s.axis === aid);
      const style = styleOf(on[0]!);
      const x = g.px0 - 4 - ai * AXIS_WIDTH;
      const tk = ticks(a.min, a.max, Math.max(2, (sg.y1 - sg.y0) / 34));
      const dec = decimalsForStep(tk.step);
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 0.5, sg.y0); ctx.lineTo(x + 0.5, sg.y1); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = style.color;
      ctx.textAlign = 'right';
      for (const v of tk.values) {
        const y = valueToY(sg, a.min, a.max, v);
        if (y < sg.y0 + 3 || y > sg.y1 - 3) continue;
        ctx.fillText(v.toFixed(dec), x - 4, y + 4);
        ctx.beginPath(); ctx.moveTo(x, y + 0.5); ctx.lineTo(x - 3, y + 0.5); ctx.stroke();
        if (ai === 0) { ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(g.px0, y + 0.5); ctx.lineTo(g.px1, y + 0.5); ctx.stroke(); ctx.strokeStyle = style.color; }
      }
      ctx.save();
      ctx.translate(x - 42, (sg.y0 + sg.y1) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = th.muted;
      ctx.fillText(`${a.name ?? ''}${on.length > 1 ? ` · ${on.length} signals` : ''}`, 0, 0);
      ctx.restore();
    });
    for (const s of [...here].sort((p, q) => (p.top ? 1 : 0) - (q.top ? 1 : 0))) drawSignal(ctx, g, cfg, rec, view, s, sg, th, st.selected.has(s.id));
  }

  if (g.events) {
    const e = g.events;
    ctx.fillStyle = th.paper;
    ctx.fillRect(g.px0, e.y0, span, e.y1 - e.y0);
    ctx.strokeStyle = th.line;
    ctx.strokeRect(g.px0 + 0.5, e.y0 + 0.5, span - 1, e.y1 - e.y0 - 1);
    ctx.fillStyle = th.muted;
    ctx.textAlign = 'right';
    ctx.fillText('Events', g.px0 - 6, e.y0 + 18);
    for (const ev of rec.events) {
      if (ev.t < view[0] || ev.t > view[1]) continue;
      const x = timeToX(g, view, ev.t);
      const cy = (e.y0 + e.y1) / 2;
      ctx.fillStyle = ev.kind === 'fault' ? th.bad : ev.kind === 'warn' ? th.warn : th.accent2;
      ctx.beginPath(); ctx.moveTo(x, cy - 7); ctx.lineTo(x + 6, cy); ctx.lineTo(x, cy + 7); ctx.lineTo(x - 6, cy); ctx.closePath(); ctx.fill();
    }
  }

  ctx.fillStyle = th.muted;
  ctx.textAlign = 'center';
  for (const t of xt.values) { const x = timeToX(g, view, t); if (x > g.px0 + 10 && x < g.px1 - 10) ctx.fillText(`${t.toFixed(tdec)} s`, x, g.time.y0 + 13); }

  for (const w of ['a', 'b'] as const) {
    const c = cfg.cur[w];
    if (!c) continue;
    const x = timeToX(g, view, c.t);
    if (x < g.px0 - 1 || x > g.px1 + 1) continue;
    const active = cfg.cur.active === w;
    ctx.strokeStyle = active ? th.accent : th.accent2;
    ctx.lineWidth = active ? 1.6 : 1.2;
    ctx.beginPath(); ctx.moveTo(x + 0.5, TOP - 2); ctx.lineTo(x + 0.5, g.time.y0); ctx.stroke();
    ctx.lineWidth = 1;
    const label = `${w.toUpperCase()}${c.anchor !== undefined ? ' ⚓' : ''}`;
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = active ? th.accent : th.accent2;
    ctx.fillRect(x - tw / 2, 3, tw, 17);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, 15);
    for (const s of cfg.sigs) {
      if (!s.visible) continue;
      const sg = g.strips.find((q) => q.id === s.strip);
      const d = sigData(s);
      if (!sg || !d) continue;
      const v = valueAt(d, c.t);
      if (v === null) continue;
      const y = sg.kind === 'bool' ? boolY(sg, v) : valueToY(sg, cfg.axes[s.axis]!.min, cfg.axes[s.axis]!.max, v);
      if (y < sg.y0 || y > sg.y1) continue;
      ctx.fillStyle = styleOf(s).color;
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (cfg.cur.a && cfg.cur.b) {
    const dt = cfg.cur.b.t - cfg.cur.a.t;
    ctx.fillStyle = th.text;
    ctx.textAlign = 'center';
    const mid = Math.min(g.px1 - 90, Math.max(g.px0 + 90, (timeToX(g, view, cfg.cur.a.t) + timeToX(g, view, cfg.cur.b.t)) / 2));
    ctx.fillText(`Δt ${dt.toFixed(3)} s${dt ? ` · ${(1 / Math.abs(dt)).toFixed(3)} Hz` : ''}`, mid, TOP - 7);
  }
  if (st.hoverX !== null) {
    ctx.strokeStyle = th.muted;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(st.hoverX + 0.5, TOP); ctx.lineTo(st.hoverX + 0.5, g.time.y0); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  if (st.rubber) {
    const r = st.rubber;
    ctx.fillStyle = th.accent;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = th.accent;
    ctx.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0, r.y1 - r.y0);
  }
  drawSlider(ctx, g, cfg, rec, view, th);
}

function drawSignal(ctx: CanvasRenderingContext2D, g: Geometry, cfg: AnalyzerConfig, rec: Recording, view: readonly [number, number], s: SigCfg, sg: { y0: number; y1: number }, th: Theme, selected = false): void {
  const d = rec.signals[s.key];
  if (!d || !s.visible) return;
  const bool = d.bool || s.axis === NO_AXIS;
  const a = cfg.axes[s.axis];
  const Y = bool ? (v: number) => boolY(sg, v) : (v: number) => valueToY(sg, a!.min, a!.max, v);
  const style = styleOf(s);
  const span = g.px1 - g.px0;
  ctx.save();
  ctx.beginPath(); ctx.rect(g.px0, sg.y0, span, sg.y1 - sg.y0); ctx.clip();
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = (s.top || selected ? s.width + 1 : s.width);
  ctx.lineJoin = 'round';
  ctx.setLineDash(bool ? [] : style.dash);
  const cols = reduceColumns(d, view[0], view[1], Math.max(1, Math.floor(span)));
  ctx.beginPath();
  if (cols.density > 2) {
    let started = false;
    for (let c = 0; c < cols.min.length; c += 1) {
      if (Number.isNaN(cols.min[c]!)) continue;
      const x = g.px0 + c + 0.5;
      if (!started) { ctx.moveTo(x, Y(cols.first[c]!)); started = true; }
      ctx.lineTo(x, Y(cols.first[c]!)); ctx.lineTo(x, Y(cols.min[c]!)); ctx.lineTo(x, Y(cols.max[c]!)); ctx.lineTo(x, Y(cols.last[c]!));
    }
  } else {
    let lo = Math.max(0, lowerIndex(d, view[0]) - 1);
    const hi = Math.min(d.t.length - 1, lowerIndex(d, view[1]) + 1);
    let prev = 0;
    for (; lo <= hi; lo += 1) {
      const x = timeToX(g, view, d.t[lo]!);
      const y = Y(d.v[lo]!);
      if (lo === Math.max(0, lowerIndex(d, view[0]) - 1)) ctx.moveTo(x, y);
      else { if (s.step || bool) ctx.lineTo(x, prev); ctx.lineTo(x, y); }
      prev = y;
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (bool) { ctx.globalAlpha = 0.18; ctx.lineTo(g.px1, Y(0)); ctx.lineTo(g.px0, Y(0)); ctx.fill(); ctx.globalAlpha = 1; }
  if (s.marks && cols.density < 0.18) {
    for (let i = Math.max(0, lowerIndex(d, view[0]) - 1); i < d.t.length && d.t[i]! <= view[1]; i += 1) { ctx.beginPath(); ctx.arc(timeToX(g, view, d.t[i]!), Y(d.v[i]!), 2.6, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
  void th;
}
const lowerIndex = (d: SignalData, t: number): number => { let lo = 0; let hi = d.t.length; while (lo < hi) { const m = (lo + hi) >>> 1; if (d.t[m]! < t) lo = m + 1; else hi = m; } return lo; };

function drawSlider(ctx: CanvasRenderingContext2D, g: Geometry, cfg: AnalyzerConfig, rec: Recording, view: readonly [number, number], th: Theme): void {
  const sl = g.slider;
  const span = g.px1 - g.px0;
  const full = rec.duration || 1;
  ctx.fillStyle = th.paper;
  ctx.fillRect(g.px0, sl.y0, span, sl.y1 - sl.y0);
  ctx.strokeStyle = th.line;
  ctx.strokeRect(g.px0 + 0.5, sl.y0 + 0.5, span - 1, sl.y1 - sl.y0 - 1);
  const ref = cfg.sigs.find((s) => s.visible && rec.signals[s.key] && !rec.signals[s.key]!.bool) ?? cfg.sigs[0];
  const d = ref ? rec.signals[ref.key] : undefined;
  if (d && ref) {
    const cols = reduceColumns(d, 0, full, Math.max(1, Math.floor(span)));
    let lo = Infinity; let hi = -Infinity;
    for (let c = 0; c < cols.min.length; c += 1) { if (Number.isNaN(cols.min[c]!)) continue; lo = Math.min(lo, cols.min[c]!); hi = Math.max(hi, cols.max[c]!); }
    ctx.strokeStyle = styleOf(ref).color;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    let started = false;
    for (let c = 0; c < cols.min.length; c += 1) {
      if (Number.isNaN(cols.min[c]!)) continue;
      const y = sl.y1 - 4 - (((cols.min[c]! + cols.max[c]!) / 2 - lo) / (hi - lo || 1)) * (sl.y1 - sl.y0 - 8);
      if (!started) { ctx.moveTo(g.px0 + c, y); started = true; } else ctx.lineTo(g.px0 + c, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const sx = (t: number) => g.px0 + (t / full) * span;
  const a = sx(view[0]);
  const b = sx(view[1]);
  ctx.fillStyle = th.accent;
  ctx.globalAlpha = 0.14;
  ctx.fillRect(a, sl.y0, Math.max(3, b - a), sl.y1 - sl.y0);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(a + 1, sl.y0 + 1, Math.max(3, b - a) - 2, sl.y1 - sl.y0 - 2);
  ctx.lineWidth = 1;
  ctx.fillStyle = th.accent;
  ctx.fillRect(a - 1, sl.y0 + 8, 4, sl.y1 - sl.y0 - 16);
  ctx.fillRect(b - 3, sl.y0 + 8, 4, sl.y1 - sl.y0 - 16);
  for (const w of ['a', 'b'] as const) {
    const c = cfg.cur[w];
    if (!c) continue;
    ctx.strokeStyle = cfg.cur.active === w ? th.accent : th.accent2;
    ctx.beginPath(); ctx.moveTo(sx(c.t) + 0.5, sl.y0); ctx.lineTo(sx(c.t) + 0.5, sl.y1); ctx.stroke();
  }
  for (const ev of rec.events) {
    ctx.fillStyle = ev.kind === 'fault' ? th.bad : ev.kind === 'warn' ? th.warn : th.accent2;
    ctx.fillRect(sx(ev.t) - 1, sl.y1 - 5, 3, 5);
  }
  ctx.fillStyle = th.muted;
  ctx.textAlign = 'left';
  ctx.fillText('0 s', g.px0 + 3, sl.y0 + 12);
  ctx.textAlign = 'right';
  ctx.fillText(`${full.toFixed(0)} s`, g.px1 - 3, sl.y0 + 12);
}
