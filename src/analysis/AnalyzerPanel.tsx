import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Panel } from '../components/Panel';
import { useProject, useProjectStore } from '../workspace/context';
import { Modal, useContextMenu, useToast } from '../workspace/ui';
import { useRecordings } from './context';
import { drawAnalyzer, hitTest, layout, readTheme, styleOf, xToTime, yToValue, type Geometry, type Hit } from './draw';
import { FormulaError, evaluate } from './expression';
import { clamp, clampView, formatValue, nearestSample, panBy, rangeStats, stepSample, valueAt, zoomAbout, type Recording, type SignalData } from './math';
import {
  addSignals, addStrip, applyAnchors, COLORS, cycleCursors, deleteStrip, fitAxes, moveSignals, moveStrip, NO_AXIS, parseConfig, removeSignals, setAxis, setCursor, stripAxes, shareAxis, splitAxes,
  type AnalyzerConfig, type SigCfg,
} from './model';

const MIN_SPAN = 0.005;
const toJson = (c: AnalyzerConfig): Record<string, unknown> => JSON.parse(JSON.stringify(c)) as Record<string, unknown>;
const COLOR_NAMES = ['Blue', 'Orange', 'Green', 'Magenta', 'Gold', 'Sky', 'Grey', 'Black'];

/** The aliases a formula uses for the signals of a recording: the signal's name, made safe, and unique. */
export function aliases(rec: Recording): Map<string, SignalData> {
  const out = new Map<string, SignalData>();
  for (const s of Object.values(rec.signals)) {
    const base = s.label.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'signal';
    let name = base;
    let n = 2;
    while (out.has(name)) { name = `${base}_${n}`; n += 1; }
    out.set(name, s);
  }
  return out;
}

function CalcDialog({ rec, onAdd, onClose }: { rec: Recording; onAdd: (s: SignalData, formula: string) => void; onClose: () => void }) {
  const names = useMemo(() => aliases(rec), [rec]);
  const [label, setLabel] = useState('Calculated');
  const [formula, setFormula] = useState('');
  const [unit, setUnit] = useState('');
  const [error, setError] = useState('');
  const go = () => {
    try {
      const r = evaluate(formula, names);
      if (r.t.length === 0) { setError('The formula gives no values for this recording.'); return; }
      onAdd({ key: `calc:${Date.now().toString(36)}`, label: label.trim() || 'Calculated', unit, decimals: 2, bool: false, t: r.t, v: r.v }, formula);
      onClose();
    } catch (e) { setError(e instanceof FormulaError ? e.message : 'That formula could not be read.'); }
  };
  return (
    <Modal title="Calculated signal" onClose={onClose} wide footer={<><button type="button" className="bw-button" onClick={onClose}>Cancel</button><button type="button" className="bw-button bw-primary" onClick={go} disabled={!formula.trim()}>Add to plot</button></>}>
      <p className="bw-fine">Combine signals of this recording with + − × ÷ and abs, sqrt, min, max. A signal keeps its last value until it changes.</p>
      <div className="bw-form-row">
        <label className="bw-field"><span>Name</span><input data-autofocus value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="bw-field bw-grow"><span>Formula</span><input className="bw-mono" value={formula} placeholder="for example  BatteryV * BatteryA" onChange={(e) => { setFormula(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} /></label>
        <label className="bw-field"><span>Unit</span><input value={unit} maxLength={12} style={{ width: 80 }} onChange={(e) => setUnit(e.target.value)} /></label>
      </div>
      {error && <p className="bw-error" role="alert">{error}</p>}
      <div className="bw-chips" role="group" aria-label="Signals you can use">
        {[...names.keys()].map((n) => <button key={n} type="button" className="bw-button bw-small" onClick={() => setFormula((f) => `${f}${f && !/[ (+\-*/]$/.test(f) ? ' ' : ''}${n}`)}>{n}</button>)}
      </div>
    </Modal>
  );
}

function AxisDialog({ cfg, axisId, rec, view, onChange, onClose }: { cfg: AnalyzerConfig; axisId: string; rec: Recording; view: readonly [number, number]; onChange: (c: AnalyzerConfig) => void; onClose: () => void }) {
  const a = cfg.axes[axisId]!;
  const [min, setMin] = useState(String(+a.min.toFixed(4)));
  const [max, setMax] = useState(String(+a.max.toFixed(4)));
  const [name, setName] = useState(a.name ?? '');
  const on = cfg.sigs.filter((s) => s.axis === axisId);
  const apply = () => {
    const lo = Number(min);
    const hi = Number(max);
    let next = cfg;
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) next = setAxis(next, axisId, { min: lo, max: hi });
    next = setAxis(next, axisId, { name: name.slice(0, 40) });
    onChange(next);
  };
  return (
    <Modal title="Axis range" onClose={() => { apply(); onClose(); }} footer={<button type="button" className="bw-button bw-primary" onClick={() => { apply(); onClose(); }}>Done</button>}>
      <p className="bw-fine">{on.map((s) => rec.signals[s.key]?.label ?? s.key).join(', ')}</p>
      <div className="bw-form-row">
        <label className="bw-field"><span>Minimum</span><input data-autofocus className="bw-mono" value={min} onChange={(e) => setMin(e.target.value)} /></label>
        <label className="bw-field"><span>Maximum</span><input className="bw-mono" value={max} onChange={(e) => setMax(e.target.value)} /></label>
        <label className="bw-field"><span>Axis name</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <div className="bw-actions">
        <button type="button" className="bw-button bw-small" onClick={() => { const n = fitAxes(cfg, rec, [axisId], view[0], view[1]); const x = n.axes[axisId]!; setMin(String(+x.min.toFixed(4))); setMax(String(+x.max.toFixed(4))); onChange(n); }}>Zoom to fit</button>
        <button type="button" className="bw-button bw-small" onClick={() => { const lo = Number(min); const hi = Number(max); if (hi > lo) onChange(setAxis(cfg, axisId, { min: lo, max: hi, fav: [lo, hi] })); }}>★ Set as favourite range</button>
        <button type="button" className="bw-button bw-small" disabled={!a.fav} onClick={() => { if (a.fav) { setMin(String(+a.fav[0].toFixed(4))); setMax(String(+a.fav[1].toFixed(4))); onChange(setAxis(cfg, axisId, { min: a.fav[0], max: a.fav[1] })); } }}>Apply favourite</button>
      </div>
    </Modal>
  );
}

export function AnalyzerPanel({ pid }: { pid: string }) {
  const project = useProjectStore();
  const { project: pr } = useProject();
  const recordings = useRecordings();
  const toast = useToast();
  const stored = pr.panels[pid]?.config;
  const [cfg, setCfg] = useState<AnalyzerConfig>(() => parseConfig(stored));
  const [seen, setSeen] = useState(stored);
  // A change made elsewhere (a window sent from the Scope) replaces what is shown. Changes made here are marked as seen when saved.
  if (stored !== seen) { setSeen(stored); setCfg(parseConfig(stored)); }
  const liveRec = recordings.find((r) => r.id === cfg.file);
  // Calculated signals are worked out again from their formulas, here and whenever the recording changes.
  const rec = useMemo<Recording | null>(() => {
    if (!liveRec) return null;
    const names = aliases(liveRec);
    const signals = { ...liveRec.signals };
    for (const c of cfg.calcs) {
      try { const r = evaluate(c.formula, names); signals[c.key] = { key: c.key, label: c.label, unit: c.unit, decimals: 2, bool: false, t: r.t, v: r.v }; } catch { /* a formula that no longer fits the recording shows nothing */ }
    }
    return { ...liveRec, signals };
  }, [liveRec, cfg.calcs]);

  const timer = useRef<number | null>(null);
  const latest = useRef(cfg);
  const flush = useCallback(() => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    const json = toJson(latest.current);
    setSeen(json);
    project.setPanelConfig(pid, json);
  }, [project, pid]);
  const commit = useCallback((next: AnalyzerConfig) => {
    latest.current = next;
    setCfg(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 500);
  }, [flush]);
  useEffect(() => () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; project.setPanelConfig(pid, toJson(latest.current)); } }, [project, pid]);

  const full: [number, number] = [0, rec?.duration ?? 1];
  const view: [number, number] = cfg.view ? clampView(cfg.view, full, MIN_SPAN) : full;
  const setView = useCallback((v: readonly [number, number]) => {
    const next = clampView(v, [0, rec?.duration ?? 1], MIN_SPAN);
    commit(applyAnchors({ ...latest.current, view: next }, next));
  }, [commit, rec?.duration]);

  /* ---- canvas ---- */
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const geo = useRef<Geometry | null>(null);
  const ui = useRef<{ hoverX: number | null; rubber: { x0: number; y0: number; x1: number; y1: number } | null; focusStrip: string | null }>({ hoverX: null, rubber: null, focusStrip: null });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const raf = useRef(0);
  const drawNow = useCallback(() => {
    raf.current = 0;
    const c = canvas.current;
    if (!c || !rec || size.w === 0) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(size.w * dpr));
    c.height = Math.max(1, Math.round(size.h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = layout(cfg, rec, size.w, size.h);
    geo.current = g;
    drawAnalyzer(ctx, g, cfg, rec, view, { ...ui.current, selected }, readTheme());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, rec, size, selected, view[0], view[1]]);
  const redraw = useCallback(() => { if (!raf.current) raf.current = requestAnimationFrame(drawNow); }, [drawNow]);
  useEffect(() => { redraw(); }, [redraw]);
  useEffect(() => {
    const el = holder.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [rec]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const [axisDialog, setAxisDialog] = useState<string | null>(null);
  const [calc, setCalc] = useState(false);
  const menu = useContextMenu('Analyzer');

  const hit = useCallback((x: number, y: number): Hit => (geo.current && rec ? hitTest(geo.current, cfg, rec, view, x, y) : { region: 'none' }), [cfg, rec, view]);
  const pointer = (e: { clientX: number; clientY: number }) => { const r = canvas.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const placeCursor = useCallback((which: 'a' | 'b', t: number) => {
    if (!rec) return;
    let tt = clamp(t, 0, rec.duration);
    if (latest.current.sample) {
      const ref = latest.current.sigs.find((s) => s.visible && rec.signals[s.key]);
      const snap = ref ? nearestSample(rec.signals[ref.key]!, tt) : null;
      if (snap !== null) tt = snap;
    }
    commit(setCursor(latest.current, which, tt, view));
  }, [rec, commit, view]);

  const stripMenu = (x: number, y: number, stripId: string | null) => {
    const strip = cfg.strips.find((s) => s.id === stripId);
    const items = [];
    if (strip) {
      items.push({ label: 'Zoom to fit signals', onSelect: () => commit(fitAxes(cfg, rec!, stripAxes(cfg, strip.id), view[0], view[1])) });
      if (strip.kind === 'analog') {
        const ids = cfg.sigs.filter((s) => s.strip === strip.id).map((s) => s.id);
        items.push({ label: 'Use one common axis here', onSelect: () => commit(shareAxis(cfg, ids)) }, { label: 'Use individual axes here', onSelect: () => commit(splitAxes(cfg, ids)) });
      }
      items.push({ separator: true as const }, { label: 'Add an analog strip below', onSelect: () => commit(addStrip(cfg, strip.id)) }, { label: 'Move strip up', onSelect: () => commit(moveStrip(cfg, strip.id, -1)) }, { label: 'Move strip down', onSelect: () => commit(moveStrip(cfg, strip.id, 1)) }, { label: 'Delete strip', onSelect: () => commit(deleteStrip(cfg, strip.id)) });
    } else items.push({ label: 'Add an analog strip', onSelect: () => commit(addStrip(cfg)) });
    menu.open(x, y, items);
  };

  /* ---- pointer ---- */
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!rec || !geo.current) return;
    canvas.current?.focus();
    const g = geo.current;
    const start = pointer(e);
    const h = hit(start.x, start.y);
    if ('strip' in h && h.strip) ui.current.focusStrip = h.strip.id;
    const zoomRect = e.button === 2 || (e.button === 0 && e.shiftKey);
    const v0: [number, number] = [...view];
    const axis0 = h.region === 'axis' ? { ...cfg.axes[h.axis]! } : null;
    const button = e.button;
    let moved = false;
    let rubberBoth = false;
    const el = canvas.current!;
    el.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = pointer(ev);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (Math.hypot(dx, dy) > 4) moved = true;
      if (!moved) return;
      if (zoomRect && h.region === 'plot') {
        const timeOnly = Math.abs(dy) < 12;
        const valueOnly = Math.abs(dx) < 12;
        rubberBoth = !timeOnly && !valueOnly;
        ui.current.rubber = { x0: valueOnly ? g.px0 : Math.min(start.x, p.x), x1: valueOnly ? g.px1 : Math.max(start.x, p.x), y0: timeOnly ? 26 : Math.min(start.y, p.y), y1: timeOnly ? g.time.y0 : Math.max(start.y, p.y) };
        redraw();
        return;
      }
      if (h.region === 'plot') {
        const dt = (-dx / (g.px1 - g.px0)) * (v0[1] - v0[0]);
        const next = panBy(v0, dt, full);
        commit(applyAnchors({ ...latest.current, view: next }, next));
      } else if (h.region === 'axis' && axis0) {
        const sg = h.strip;
        const dv = (dy / (sg.y1 - sg.y0)) * (axis0.max - axis0.min);
        commit(setAxis(latest.current, h.axis, { min: axis0.min + dv, max: axis0.max + dv }));
      } else if (h.region === 'cursor') placeCursor(h.which, xToTime(g, view, p.x));
      else if (h.region === 'slider') {
        const per = rec.duration / (g.px1 - g.px0);
        const d = dx * per;
        if (h.part === 'window') setView([v0[0] + d, v0[1] + d]);
        else if (h.part === 'left') setView([v0[0] + d, v0[1]]);
        else if (h.part === 'right') setView([v0[0], v0[1] + d]);
        else { const t = (p.x - g.px0) * per; setView([t - (v0[1] - v0[0]) / 2, t + (v0[1] - v0[0]) / 2]); }
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const p = pointer(ev);
      const rb = ui.current.rubber;
      ui.current.rubber = null;
      if (rb) {
        const t1 = xToTime(g, view, rb.x0);
        const t2 = xToTime(g, view, rb.x1);
        let next = latest.current;
        if (rb.x1 - rb.x0 > 4 && t2 - t1 > MIN_SPAN) { const nv = clampView([t1, t2], full, MIN_SPAN); next = applyAnchors({ ...next, view: nv }, nv); }
        if (h.region === 'plot' && h.strip && (rubberBoth || rb.y1 - rb.y0 < g.time.y0 - 30)) {
          const st = g.strips.find((s) => s.id === h.strip!.id)!;
          if (rubberBoth) for (const aid of st.axes) { const a = next.axes[aid]!; const lo = yToValue(st, a.min, a.max, rb.y1); const hi = yToValue(st, a.min, a.max, rb.y0); if (hi - lo > 1e-9) next = setAxis(next, aid, { min: lo, max: hi }); }
        }
        commit(next);
        return;
      }
      if (!moved) {
        if (button === 2) { if (h.region !== 'none') stripMenu(ev.clientX, ev.clientY, 'strip' in h && h.strip ? h.strip.id : null); }
        else if (h.region === 'plot' && (cfg.cur.a || cfg.cur.b)) placeCursor(cfg.cur.active, xToTime(g, view, p.x));
        else if (h.region === 'event') { placeCursor('a', rec.events[h.index]!.t); toast.show(rec.events[h.index]!.label); }
        else if (h.region === 'slider' && h.part === 'track') { const t = ((p.x - g.px0) / (g.px1 - g.px0)) * rec.duration; const w = view[1] - view[0]; setView([t - w / 2, t + w / 2]); }
      }
      redraw();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!rec || !geo.current) return;
    const p = pointer(e);
    const h = hit(p.x, p.y);
    ui.current.hoverX = h.region === 'plot' ? p.x : null;
    const c = canvas.current!;
    c.style.cursor = h.region === 'cursor' ? 'ew-resize' : h.region === 'axis' ? 'ns-resize' : h.region === 'slider' ? (h.part === 'left' || h.part === 'right' ? 'ew-resize' : 'grab') : h.region === 'event' ? 'pointer' : 'crosshair';
    c.title = h.region === 'event' ? `${rec.events[h.index]!.label} · ${rec.events[h.index]!.t.toFixed(2)} s` : '';
    redraw();
  };
  const onDoubleClick = (e: ReactPointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    if (!rec || !geo.current) return;
    const p = pointer(e);
    const h = hit(p.x, p.y);
    if (h.region === 'slider' && h.part === 'left') setView([0, view[1]]);
    else if (h.region === 'slider' && h.part === 'right') setView([view[0], rec.duration]);
    else if (h.region === 'axis') setAxisDialog(h.axis);
    else if (h.region === 'plot') placeCursor(cfg.cur.a && !cfg.cur.b ? 'b' : cfg.cur.a ? cfg.cur.active : 'a', xToTime(geo.current, view, p.x));
  };

  // The wheel needs a non-passive listener, so it is attached by hand.
  const wheelState = useRef({ cfg, rec, view, hit, commit, setView });
  useEffect(() => { wheelState.current = { cfg, rec, view, hit, commit, setView }; });
  useEffect(() => {
    const el = canvas.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      const s = wheelState.current;
      const g = geo.current;
      if (!s.rec || !g) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const h = s.hit(x, e.clientY - r.top);
      if (h.region === 'none') return;
      e.preventDefault();
      const f = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      if (h.region === 'axis') {
        const a = s.cfg.axes[h.axis]!;
        if (e.ctrlKey) { const m = (a.min + a.max) / 2; const hw = ((a.max - a.min) / 2) * f; s.commit(setAxis(s.cfg, h.axis, { min: m - hw, max: m + hw })); }
        else { const d = (a.max - a.min) * 0.1 * Math.sign(e.deltaY); s.commit(setAxis(s.cfg, h.axis, { min: a.min + d, max: a.max + d })); }
        return;
      }
      if (h.region === 'plot' && e.ctrlKey && h.strip) {
        let next = s.cfg;
        for (const aid of h.strip.axes) { const a = next.axes[aid]!; const m = (a.min + a.max) / 2; const hw = ((a.max - a.min) / 2) * f; next = setAxis(next, aid, { min: m - hw, max: m + hw }); }
        s.commit(next);
        return;
      }
      if (e.shiftKey) { s.setView(panBy(s.view, (s.view[1] - s.view[0]) * 0.12 * Math.sign(e.deltaY), [0, s.rec.duration])); return; }
      s.setView(zoomAbout(s.view, xToTime(g, s.view, clamp(x, g.px0, g.px1)), f, [0, s.rec.duration], MIN_SPAN));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [rec]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (!rec || !geo.current) return;
    const g = geo.current;
    const active = cfg.cur[cfg.cur.active];
    const w = view[1] - view[0];
    const pxStep = w / (g.px1 - g.px0);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      if (active) {
        if (cfg.sample) {
          const ref = cfg.sigs.find((s) => s.visible && rec.signals[s.key]);
          const next = ref ? stepSample(rec.signals[ref.key]!, active.t, dir as -1 | 1) : null;
          if (next !== null) placeCursor(cfg.cur.active, next);
        } else placeCursor(cfg.cur.active, active.t + dir * pxStep * (e.shiftKey ? 10 : 1));
      } else setView(panBy(view, dir * w * 0.05, full));
    } else if (e.key === 'Home') { e.preventDefault(); setView([0, w]); }
    else if (e.key === 'End') { e.preventDefault(); setView([rec.duration - w, rec.duration]); }
    else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); setView(panBy(view, e.key === 'PageDown' ? w : -w, full)); }
    else if (e.key === 'f' || e.key === 'F') commit(fitAxes(cfg, rec, Object.keys(cfg.axes), view[0], view[1]));
    else if (e.key === 'c' || e.key === 'C') commit(cycleCursors(cfg, view));
    else if (e.key === '+' || e.key === '=') setView(zoomAbout(view, (view[0] + view[1]) / 2, 1 / 1.3, full, MIN_SPAN));
    else if (e.key === '-') setView(zoomAbout(view, (view[0] + view[1]) / 2, 1.3, full, MIN_SPAN));
    else if (e.ctrlKey && e.key === '1' && cfg.cur.a && cfg.cur.b) { e.preventDefault(); commit({ ...cfg, cur: { ...cfg.cur, active: cfg.cur.active === 'a' ? 'b' : 'a' } }); }
  };

  /* ---- toolbar ---- */
  const addMenu = (x: number, y: number) => {
    if (!rec) return;
    const used = new Set(cfg.sigs.map((s) => s.key));
    const items = Object.values(rec.signals).filter((s) => !used.has(s.key)).map((s) => ({ label: s.label, hint: s.unit || (s.bool ? 'on/off' : ''), onSelect: () => commit(addSignals(cfg, rec, [s.key], cfg.strips.find((st) => st.kind === 'analog')?.id ?? 'new', 'unit')) }));
    menu.open(x, y, items.length ? items : [{ heading: 'Every signal is already on the plot' }]);
  };

  const csv = (): string => {
    if (!rec) return '';
    const sigs = cfg.sigs.filter((s) => s.visible && rec.signals[s.key]).map((s) => rec.signals[s.key]!);
    const lines = [`time_s,${sigs.map((s) => `"${s.label.replace(/"/g, '""')}${s.unit ? ` [${s.unit}]` : ''}"`).join(',')}`];
    const times = [...new Set(sigs.flatMap((s) => Array.from(s.t).filter((t) => t >= view[0] && t <= view[1])))].sort((a, b) => a - b).slice(0, 200_000);
    for (const t of times) lines.push([t.toFixed(6), ...sigs.map((s) => { const v = valueAt(s, t); return v === null ? '' : String(v); })].join(','));
    return `${lines.join('\r\n')}\r\n`;
  };

  /* ---- signal list ---- */
  const dec = (s: SigCfg, d: SignalData) => s.decimals ?? d.decimals;
  const a = cfg.cur.a;
  const b = cfg.cur.b;
  const range: [number, number] = a && b ? [Math.min(a.t, b.t), Math.max(a.t, b.t)] : view;
  const rows = rec ? cfg.sigs.map((s) => ({ s, d: rec.signals[s.key] })).filter((r): r is { s: SigCfg; d: SignalData } => !!r.d) : [];
  const rowMenu = (x: number, y: number, row: SigCfg) => {
    const ids = selected.has(row.id) ? [...selected] : [row.id];
    const chosen = cfg.sigs.filter((s) => ids.includes(s.id));
    menu.open(x, y, [
      { label: 'Zoom to fit', onSelect: () => commit(fitAxes(cfg, rec!, [...new Set(chosen.map((s) => s.axis))].filter((k) => k !== NO_AXIS), view[0], view[1])) },
      { label: 'Use common axes', onSelect: () => commit(shareAxis(cfg, ids)) },
      { label: 'Use individual axes', onSelect: () => commit(splitAxes(cfg, ids)) },
      { label: 'Move to a new strip', onSelect: () => commit(moveSignals(cfg, rec!, ids, 'new', 'individual')) },
      { separator: true },
      { label: row.top ? 'Stop showing on top' : 'Show on top', onSelect: () => commit({ ...cfg, sigs: cfg.sigs.map((s) => (ids.includes(s.id) ? { ...s, top: !row.top } : s)) }) },
      { label: row.visible ? 'Hide curve' : 'Show curve', onSelect: () => commit({ ...cfg, sigs: cfg.sigs.map((s) => (ids.includes(s.id) ? { ...s, visible: !row.visible } : s)) }) },
      { label: 'More decimals', onSelect: () => commit({ ...cfg, sigs: cfg.sigs.map((s) => (ids.includes(s.id) ? { ...s, decimals: Math.min(6, (s.decimals ?? rec!.signals[s.key]!.decimals) + 1) } : s)) }) },
      { label: 'Fewer decimals', onSelect: () => commit({ ...cfg, sigs: cfg.sigs.map((s) => (ids.includes(s.id) ? { ...s, decimals: Math.max(0, (s.decimals ?? rec!.signals[s.key]!.decimals) - 1) } : s)) }) },
      { separator: true },
      { label: 'Remove', onSelect: () => { commit(removeSignals(cfg, ids)); setSelected(new Set()); } },
    ]);
  };
  const styleMenu = (x: number, y: number, s: SigCfg) => {
    const set = (patch: Partial<SigCfg>) => commit({ ...cfg, sigs: cfg.sigs.map((q) => (q.id === s.id ? { ...q, ...patch } : q)) });
    menu.open(x, y, [
      { heading: 'Colour and line pattern' },
      ...Array.from({ length: COLORS }, (_, i) => ({ label: COLOR_NAMES[i]!, hint: s.color === i + 1 ? 'current' : '', onSelect: () => set({ color: i + 1 }) })),
      { heading: 'Line' },
      ...([['Thin', 1], ['Normal', 1.75], ['Thick', 3]] as const).map(([n, w]) => ({ label: n, hint: s.width === w ? 'current' : '', onSelect: () => set({ width: w }) })),
      { label: s.step ? 'Join samples with straight lines' : 'Join samples as steps', onSelect: () => set({ step: !s.step }) },
      { label: s.marks ? 'Hide sample markers' : 'Show sample markers when zoomed in', onSelect: () => set({ marks: !s.marks }) },
    ]);
  };

  const recOptions = (
    <select className="bw-source-select" aria-label="Recording" value={cfg.file ?? ''} onChange={(e) => { const id = e.target.value; if (!id) return; commit({ ...cfg, file: id, strips: [], sigs: [], axes: {}, calcs: [], view: undefined, cur: { active: 'a' } }); }}>
      {!liveRec && <option value="">Choose a recording</option>}
      {recordings.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  );

  if (!rec) {
    return (
      <Panel id="analyzer" title="Analyzer" status="No recording">
        <div className="bw-empty-block">
          <p><strong>{cfg.file ? 'This recording is not available here.' : 'Choose a recording to study.'}</strong></p>
          <p className="bw-fine">{cfg.file ? 'Recordings live in the page that made them. Send a window from the Scope again, or import its CSV in Recordings.' : 'Send a window of the Scope to the Analyzer, or import a CSV file in Recordings.'}</p>
          {recordings.length > 0 && recOptions}
        </div>
      </Panel>
    );
  }
  const status = `${rec.duration.toFixed(1)} s · ${Object.keys(rec.signals).length} signals`;
  return (
    <Panel id="analyzer" title="Analyzer" status={status}>
      <div className="bw-analyzer-tools" role="toolbar" aria-label="Analyzer tools">
        {recOptions}
        <button type="button" className="bw-button bw-small" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); addMenu(r.left, r.bottom + 4); }}>Signal</button>
        <button type="button" className="bw-button bw-small" onClick={() => setCalc(true)}>Calculated</button>
        <span className="bw-tool-sep" aria-hidden="true" />
        <button type="button" className="bw-button bw-small" onClick={() => setView(full)}>Full range</button>
        <button type="button" className="bw-button bw-small" onClick={() => commit(fitAxes(cfg, rec, Object.keys(cfg.axes), view[0], view[1]))}>Fit all</button>
        <button type="button" className="bw-button bw-small" onClick={() => commit(addStrip(cfg))}>Add strip</button>
        <span className="bw-tool-sep" aria-hidden="true" />
        <button type="button" className="bw-button bw-small" onClick={() => commit(cycleCursors(cfg, view))} title="Add cursor A, then B, then remove both (C)">Cursors</button>
        <button type="button" className="bw-button bw-small" aria-pressed={cfg.sample} onClick={() => commit({ ...cfg, sample: !cfg.sample })} title="Move cursors from sample to sample">Sample-wise</button>
        <button type="button" className="bw-button bw-small" aria-pressed={cfg.stats} onClick={() => commit({ ...cfg, stats: !cfg.stats })} title="Minimum, maximum, average and deviation">Statistics</button>
        <button type="button" className="bw-button bw-small" onClick={() => { const t = csv(); void navigator.clipboard?.writeText(t).then(() => toast.show('Copied the visible signals as CSV'), () => toast.show('Copying was blocked by the browser')); }}>Copy CSV</button>
      </div>
      <div className="bw-analyzer">
        <div ref={holder} className="bw-analyzer-plot">
          <canvas
            ref={canvas}
            tabIndex={0}
            role="img"
            aria-label="Analysis plot. The signal list beside it has the values. Mouse wheel zooms time, drag pans, Shift drag or right drag zooms an area, arrow keys move the cursor, C adds cursors, F fits the axes."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={() => { ui.current.hoverX = null; redraw(); }}
            onDoubleClick={onDoubleClick}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="bw-analyzer-list">
          <table className="bw-signal-table">
            <caption className="bw-sr-only">Signals on the plot, with values at the cursors</caption>
            <thead>
              <tr><th scope="col"><span className="bw-sr-only">Show</span></th><th scope="col"><span className="bw-sr-only">Style</span></th><th scope="col">Signal</th><th scope="col">Unit</th><th scope="col">A</th><th scope="col">B</th><th scope="col">B−A</th>{cfg.stats && <><th scope="col">Min</th><th scope="col">Max</th><th scope="col">Avg</th><th scope="col">Std</th></>}</tr>
            </thead>
            <tbody>
              {rows.map(({ s, d }) => {
                const va = a ? valueAt(d, a.t) : null;
                const vb = b ? valueAt(d, b.t) : null;
                const st = cfg.stats ? rangeStats(d, range[0], range[1]) : null;
                const n = dec(s, d);
                return (
                  <tr key={s.id} aria-selected={selected.has(s.id)} className={selected.has(s.id) ? 'is-selected' : ''} onClick={(e) => setSelected((cur) => { const next = new Set(e.ctrlKey || e.metaKey ? cur : []); if (next.has(s.id) && (e.ctrlKey || e.metaKey)) next.delete(s.id); else next.add(s.id); return next; })} onContextMenu={(e) => { e.preventDefault(); rowMenu(e.clientX, e.clientY, s); }}>
                    <td><button type="button" className="bw-icon-button" aria-pressed={s.visible} aria-label={`${s.visible ? 'Hide' : 'Show'} ${d.label}`} onClick={(e) => { e.stopPropagation(); commit({ ...cfg, sigs: cfg.sigs.map((q) => (q.id === s.id ? { ...q, visible: !q.visible } : q)) }); }}>{s.visible ? '●' : '○'}</button></td>
                    <td><button type="button" className="bw-swatch" aria-label={`Style of ${d.label}`} onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); styleMenu(r.left, r.bottom + 4, s); }}><svg width="26" height="12" aria-hidden="true"><line x1="1" y1="6" x2="25" y2="6" stroke={styleOf(s).color} strokeWidth="2" strokeDasharray={styleOf(s).dash.join(' ')} /></svg></button></td>
                    <th scope="row">{d.label}{s.top ? ' (on top)' : ''}</th>
                    <td>{d.unit}</td>
                    <td className="bw-mono">{va === null ? '' : formatValue(va, n, d.bool)}</td>
                    <td className="bw-mono">{vb === null ? '' : formatValue(vb, n, d.bool)}</td>
                    <td className="bw-mono">{va !== null && vb !== null && !d.bool ? `${vb - va >= 0 ? '+' : ''}${(vb - va).toFixed(n)}` : ''}</td>
                    {cfg.stats && (st ? <><td className="bw-mono">{st.min.toFixed(n)}</td><td className="bw-mono">{st.max.toFixed(n)}</td><td className="bw-mono">{st.avg.toFixed(n)}</td><td className="bw-mono">{st.std.toFixed(n)}</td></> : <><td /><td /><td /><td /></>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="bw-fine bw-pad">No signals yet. Choose Signal in the toolbar.</p>}
          <p className="bw-fine bw-pad">{cfg.stats ? `Statistics cover ${a && b ? `the cursor range ${range[0].toFixed(2)} to ${range[1].toFixed(2)} s` : `the visible range ${range[0].toFixed(1)} to ${range[1].toFixed(1)} s`}.` : 'Cursor values appear in columns A and B.'}</p>
        </div>
      </div>
      {menu.menu}
      {axisDialog && cfg.axes[axisDialog] && <AxisDialog cfg={cfg} axisId={axisDialog} rec={rec} view={view} onChange={commit} onClose={() => setAxisDialog(null)} />}
      {calc && <CalcDialog rec={rec} onClose={() => setCalc(false)} onAdd={(sig, formula) => { const next = { ...rec, signals: { ...rec.signals, [sig.key]: sig } }; const added = addSignals(cfg, next, [sig.key], cfg.strips.find((st) => st.kind === 'analog')?.id ?? 'new', 'individual'); commit({ ...added, calcs: [...cfg.calcs, { key: sig.key, label: sig.label, unit: sig.unit, formula }] }); }} />}
    </Panel>
  );
}
