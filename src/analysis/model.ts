// The settings of one Analyzer: strips, signals, y axes, the visible range and the cursors. Saved with the project, so it is
// validated when read. Every operation returns a new config.
import { newId } from '../workspace/layout';
import { fitRange, type Recording } from './math';

export interface AxisCfg { min: number; max: number; fav?: [number, number]; name?: string }
export interface StripCfg { id: string; kind: 'analog' | 'bool'; weight: number }
export interface SigCfg {
  id: string;
  key: string;
  strip: string;
  /** The y axis it shares or owns. Two-state signals have none. */
  axis: string;
  color: number;
  width: number;
  step: boolean;
  marks: boolean;
  visible: boolean;
  decimals?: number;
  top?: boolean;
}
export interface CalcCfg { key: string; label: string; unit: string; formula: string }
export interface CursorCfg { t: number; /** A fixed place on screen, as a share of the plot width. Absent: the cursor stays on its time. */ anchor?: number }
export interface AnalyzerConfig {
  file?: string;
  strips: StripCfg[];
  sigs: SigCfg[];
  axes: Record<string, AxisCfg>;
  /** Calculated signals. Their values are worked out again from the formula, so a project file holds no data. */
  calcs: CalcCfg[];
  view?: [number, number];
  cur: { a?: CursorCfg; b?: CursorCfg; active: 'a' | 'b' };
  sample: boolean;
  stats: boolean;
}
export type AxisMode = 'common' | 'unit' | 'individual';

export const MAX_STRIPS = 12;
export const MAX_SIGNALS = 24;
export const COLORS = 8;
export const NO_AXIS = 'none';

export const emptyConfig = (file?: string): AnalyzerConfig => ({ file, strips: [], sigs: [], axes: {}, calcs: [], cur: { active: 'a' }, sample: false, stats: false });

const rec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Reads settings from a project file. Anything unusable is dropped; a signal whose strip or axis is gone is dropped too. */
export function parseConfig(raw: unknown): AnalyzerConfig {
  const out = emptyConfig();
  if (!rec(raw)) return out;
  if (id(raw.file)) out.file = raw.file;
  const strips = new Set<string>();
  if (Array.isArray(raw.strips)) {
    for (const s of raw.strips.slice(0, MAX_STRIPS)) {
      if (!rec(s) || !id(s.id) || strips.has(s.id) || (s.kind !== 'analog' && s.kind !== 'bool')) continue;
      strips.add(s.id);
      out.strips.push({ id: s.id, kind: s.kind, weight: num(s.weight) && s.weight > 0 && s.weight < 20 ? s.weight : 1 });
    }
  }
  if (rec(raw.axes)) {
    for (const [k, a] of Object.entries(raw.axes).slice(0, 40)) {
      if (!id(k) || !rec(a) || !num(a.min) || !num(a.max) || !(a.max > a.min)) continue;
      const axis: AxisCfg = { min: a.min, max: a.max };
      if (Array.isArray(a.fav) && num(a.fav[0]) && num(a.fav[1]) && a.fav[1] > a.fav[0]) axis.fav = [a.fav[0], a.fav[1]];
      if (typeof a.name === 'string') axis.name = a.name.slice(0, 40);
      out.axes[k] = axis;
    }
  }
  const sigIds = new Set<string>();
  if (Array.isArray(raw.sigs)) {
    for (const s of raw.sigs.slice(0, MAX_SIGNALS)) {
      if (!rec(s) || !id(s.id) || sigIds.has(s.id) || typeof s.key !== 'string' || s.key.length > 160 || !id(s.strip) || !strips.has(s.strip)) continue;
      const strip = out.strips.find((x) => x.id === s.strip)!;
      const axis = typeof s.axis === 'string' ? s.axis : '';
      if (strip.kind === 'analog' && !out.axes[axis]) continue;
      sigIds.add(s.id);
      out.sigs.push({
        id: s.id, key: s.key, strip: s.strip, axis: strip.kind === 'bool' ? NO_AXIS : axis,
        color: Number.isInteger(s.color) && (s.color as number) >= 1 && (s.color as number) <= COLORS ? (s.color as number) : 1,
        width: num(s.width) && s.width >= 0.5 && s.width <= 6 ? s.width : 1.75,
        step: s.step === true, marks: s.marks !== false, visible: s.visible !== false,
        ...(Number.isInteger(s.decimals) && (s.decimals as number) >= 0 && (s.decimals as number) <= 6 ? { decimals: s.decimals as number } : {}),
        ...(s.top === true ? { top: true } : {}),
      });
    }
  }
  if (Array.isArray(raw.calcs)) {
    for (const c of raw.calcs.slice(0, 12)) {
      if (!rec(c) || typeof c.key !== 'string' || !/^calc:[A-Za-z0-9]{1,20}$/.test(c.key) || typeof c.formula !== 'string' || c.formula.length > 500) continue;
      if (!out.sigs.some((x) => x.key === c.key)) continue;
      out.calcs.push({ key: c.key, label: typeof c.label === 'string' ? c.label.slice(0, 40) : 'Calculated', unit: typeof c.unit === 'string' ? c.unit.slice(0, 12) : '', formula: c.formula });
    }
  }
  if (Array.isArray(raw.view) && num(raw.view[0]) && num(raw.view[1]) && raw.view[1] > raw.view[0]) out.view = [raw.view[0], raw.view[1]];
  if (rec(raw.cur)) {
    for (const w of ['a', 'b'] as const) {
      const c = raw.cur[w];
      if (rec(c) && num(c.t)) out.cur[w] = { t: c.t, ...(num(c.anchor) && c.anchor >= 0 && c.anchor <= 1 ? { anchor: c.anchor } : {}) };
    }
    if (raw.cur.active === 'b' && out.cur.b) out.cur.active = 'b';
  }
  out.sample = raw.sample === true;
  out.stats = raw.stats === true;
  // Axes no signal uses are dropped.
  const used = new Set(out.sigs.map((s) => s.axis));
  for (const k of Object.keys(out.axes)) if (!used.has(k)) delete out.axes[k];
  return out;
}

export const stripAxes = (cfg: AnalyzerConfig, stripId: string): string[] => [...new Set(cfg.sigs.filter((s) => s.strip === stripId && s.axis !== NO_AXIS).map((s) => s.axis))];

function axisFor(r: Recording, key: string, view: [number, number] | undefined): AxisCfg {
  const sig = r.signals[key];
  const range = sig ? fitRange([sig], view?.[0] ?? 0, view?.[1] ?? r.duration) ?? fitRange([sig], 0, r.duration) : null;
  const [min, max] = range ?? [0, 1];
  return { min, max, fav: [min, max], name: sig?.unit ?? '' };
}

/**
 * Adds signals. Two-state signals each get a strip of their own. Analog signals go to `strip` (or a new strip) and share one axis
 * ('common'), share one axis per unit ('unit') or each get an axis ('individual').
 */
export function addSignals(cfg: AnalyzerConfig, r: Recording, keys: readonly string[], strip: string | 'new', mode: AxisMode): AnalyzerConfig {
  let next: AnalyzerConfig = { ...cfg, strips: [...cfg.strips], sigs: [...cfg.sigs], axes: { ...cfg.axes } };
  let target = strip === 'new' ? null : next.strips.find((s) => s.id === strip && s.kind === 'analog') ?? null;
  for (const key of keys) {
    const data = r.signals[key];
    if (!data || next.sigs.some((s) => s.key === key) || next.sigs.length >= MAX_SIGNALS) continue;
    const base = { id: newId('s'), key, color: (next.sigs.length % COLORS) + 1, width: 1.75, step: false, marks: true, visible: true };
    if (data.bool) {
      if (next.strips.length >= MAX_STRIPS) continue;
      const st: StripCfg = { id: newId('st'), kind: 'bool', weight: 1 };
      next.strips.push(st);
      next.sigs.push({ ...base, strip: st.id, axis: NO_AXIS });
      continue;
    }
    if (!target) {
      if (next.strips.length >= MAX_STRIPS) continue;
      target = { id: newId('st'), kind: 'analog', weight: 1 };
      const firstBool = next.strips.findIndex((s) => s.kind === 'bool');
      if (firstBool < 0) next.strips.push(target); else next.strips.splice(firstBool, 0, target);
    }
    const here = next.sigs.filter((s) => s.strip === target!.id);
    let axis: string | undefined;
    if (mode === 'common') axis = here[0]?.axis;
    else if (mode === 'unit') axis = here.find((s) => r.signals[s.key]?.unit === data.unit && data.unit !== '')?.axis;
    if (!axis) {
      axis = newId('a');
      next.axes[axis] = axisFor(r, key, cfg.view);
    } else {
      const a = next.axes[axis]!;
      const own = axisFor(r, key, cfg.view);
      next.axes[axis] = { ...a, min: Math.min(a.min, own.min), max: Math.max(a.max, own.max), fav: undefined };
      delete next.axes[axis]!.fav;
    }
    next.sigs.push({ ...base, strip: target.id, axis });
  }
  next = { ...next };
  return next;
}

/** Moves signals to a strip, with the same choice of axes as adding. A moved signal keeps its style. */
export function moveSignals(cfg: AnalyzerConfig, r: Recording, ids: readonly string[], strip: string | 'new', mode: AxisMode): AnalyzerConfig {
  const moving = cfg.sigs.filter((s) => ids.includes(s.id) && s.axis !== NO_AXIS);
  if (moving.length === 0) return cfg;
  const without = removeSignals(cfg, moving.map((s) => s.id));
  const keys = moving.map((s) => s.key);
  const added = addSignals(without, r, keys, strip, mode);
  // Restore the style of each moved signal.
  const sigs = added.sigs.map((s) => {
    const old = moving.find((m) => m.key === s.key);
    return old ? { ...s, color: old.color, width: old.width, step: old.step, marks: old.marks, visible: old.visible, decimals: old.decimals, top: old.top } : s;
  }).map((s) => { const c = { ...s }; if (c.decimals === undefined) delete c.decimals; if (!c.top) delete c.top; return c; });
  return { ...added, sigs };
}

/** Removes signals, and the strips and axes nothing uses any more. */
export function removeSignals(cfg: AnalyzerConfig, ids: readonly string[]): AnalyzerConfig {
  const sigs = cfg.sigs.filter((s) => !ids.includes(s.id));
  const strips = cfg.strips.filter((st) => sigs.some((s) => s.strip === st.id) || (st.kind === 'analog' && !cfg.sigs.some((s) => s.strip === st.id)));
  const axes = Object.fromEntries(Object.entries(cfg.axes).filter(([k]) => sigs.some((s) => s.axis === k)));
  const calcs = cfg.calcs.filter((c) => sigs.some((s) => s.key === c.key));
  return { ...cfg, sigs, strips, axes, calcs };
}

/** Puts the chosen signals of one strip on one shared axis. */
export function shareAxis(cfg: AnalyzerConfig, ids: readonly string[]): AnalyzerConfig {
  const chosen = cfg.sigs.filter((s) => ids.includes(s.id) && s.axis !== NO_AXIS);
  const first = chosen[0];
  if (!first) return cfg;
  const same = chosen.filter((s) => s.strip === first.strip);
  const axes = { ...cfg.axes };
  const lo = Math.min(...same.map((s) => cfg.axes[s.axis]!.min));
  const hi = Math.max(...same.map((s) => cfg.axes[s.axis]!.max));
  axes[first.axis] = { min: lo, max: hi, name: cfg.axes[first.axis]!.name };
  const sigs = cfg.sigs.map((s) => (same.some((x) => x.id === s.id) ? { ...s, axis: first.axis } : s));
  return { ...cfg, sigs, axes: Object.fromEntries(Object.entries(axes).filter(([k]) => sigs.some((s) => s.axis === k))) };
}

/** Gives each of the chosen signals its own axis again. */
export function splitAxes(cfg: AnalyzerConfig, ids: readonly string[]): AnalyzerConfig {
  const axes = { ...cfg.axes };
  const sigs = cfg.sigs.map((s) => {
    if (!ids.includes(s.id) || s.axis === NO_AXIS) return s;
    const shared = cfg.sigs.filter((x) => x.axis === s.axis).length > 1;
    const first = cfg.sigs.find((x) => x.axis === s.axis && ids.includes(x.id));
    if (!shared || first?.id === s.id) return s;
    const axis = newId('a');
    axes[axis] = { ...cfg.axes[s.axis]!, fav: cfg.axes[s.axis]!.fav ? [...cfg.axes[s.axis]!.fav!] : undefined };
    if (!axes[axis]!.fav) delete axes[axis]!.fav;
    return { ...s, axis };
  });
  return { ...cfg, sigs, axes };
}

export function setAxis(cfg: AnalyzerConfig, axisId: string, patch: Partial<AxisCfg>): AnalyzerConfig {
  const a = cfg.axes[axisId];
  if (!a) return cfg;
  const next = { ...a, ...patch };
  if (!(next.max > next.min)) return cfg;
  return { ...cfg, axes: { ...cfg.axes, [axisId]: next } };
}

/** Fits axes to the signals on them over [t0, t1]. */
export function fitAxes(cfg: AnalyzerConfig, r: Recording, axisIds: readonly string[], t0: number, t1: number): AnalyzerConfig {
  let next = cfg;
  for (const aid of axisIds) {
    const range = fitRange(cfg.sigs.filter((s) => s.axis === aid).flatMap((s) => (r.signals[s.key] ? [r.signals[s.key]!] : [])), t0, t1);
    if (range) next = setAxis(next, aid, { min: range[0], max: range[1] });
  }
  return next;
}

export function addStrip(cfg: AnalyzerConfig, after?: string): AnalyzerConfig {
  if (cfg.strips.length >= MAX_STRIPS) return cfg;
  const strip: StripCfg = { id: newId('st'), kind: 'analog', weight: 1 };
  const i = after ? cfg.strips.findIndex((s) => s.id === after) + 1 : cfg.strips.length;
  const strips = cfg.strips.slice();
  strips.splice(i, 0, strip);
  return { ...cfg, strips };
}
export function moveStrip(cfg: AnalyzerConfig, stripId: string, delta: -1 | 1): AnalyzerConfig {
  const i = cfg.strips.findIndex((s) => s.id === stripId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= cfg.strips.length) return cfg;
  const strips = cfg.strips.slice();
  [strips[i], strips[j]] = [strips[j]!, strips[i]!];
  return { ...cfg, strips };
}
export function deleteStrip(cfg: AnalyzerConfig, stripId: string): AnalyzerConfig {
  const ids = cfg.sigs.filter((s) => s.strip === stripId).map((s) => s.id);
  const cleaned = removeSignals(cfg, ids);
  return { ...cleaned, strips: cleaned.strips.filter((s) => s.id !== stripId) };
}

export function setCursor(cfg: AnalyzerConfig, which: 'a' | 'b', t: number, view: readonly [number, number]): AnalyzerConfig {
  const old = cfg.cur[which];
  const cursor: CursorCfg = { t, ...(old?.anchor !== undefined ? { anchor: (t - view[0]) / (view[1] - view[0]) } : {}) };
  return { ...cfg, cur: { ...cfg.cur, [which]: cursor, active: which } };
}
/** Add cursor A, then B, then remove both. */
export function cycleCursors(cfg: AnalyzerConfig, view: readonly [number, number]): AnalyzerConfig {
  const w = view[1] - view[0];
  const mid = view[0] + w / 2;
  if (!cfg.cur.a) return { ...cfg, cur: { ...cfg.cur, a: { t: mid - w / 4 }, active: 'a' } };
  if (!cfg.cur.b) return { ...cfg, cur: { ...cfg.cur, b: { t: mid + w / 4 }, active: 'b' } };
  return { ...cfg, cur: { active: 'a' } };
}
/** After the view changes, an anchored cursor keeps its place on screen. */
export function applyAnchors(cfg: AnalyzerConfig, view: readonly [number, number]): AnalyzerConfig {
  let cur = cfg.cur;
  for (const w of ['a', 'b'] as const) {
    const c = cur[w];
    if (c?.anchor !== undefined) cur = { ...cur, [w]: { t: view[0] + c.anchor * (view[1] - view[0]), anchor: c.anchor } };
  }
  return cur === cfg.cur ? cfg : { ...cfg, cur };
}
