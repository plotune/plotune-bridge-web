import { describe, expect, it } from 'vitest';
import type { Recording, SignalData } from '../src/analysis/math';
import { addSignals, applyAnchors, cycleCursors, deleteStrip, emptyConfig, fitAxes, moveSignals, moveStrip, NO_AXIS, parseConfig, removeSignals, setAxis, setCursor, stripAxes, shareAxis, splitAxes } from '../src/analysis/model';

const sig = (key: string, unit: string, lo: number, hi: number, bool = false): SignalData => ({ key, label: key, unit, decimals: 2, bool, t: Float64Array.from([0, 1, 2]), v: Float64Array.from([lo, (lo + hi) / 2, hi]) });
const rec: Recording = { id: 'r', name: 'R', created: 0, source: 'import', duration: 2, events: [], signals: { a: sig('a', 'V', 0, 10), b: sig('b', 'V', 2, 4), c: sig('c', 'rpm', 800, 3000), d: sig('d', '', 0, 1, true) } };

describe('adding signals', () => {
  it('shares one axis per unit, and gives other units their own', () => {
    const cfg = addSignals(emptyConfig('r'), rec, ['a', 'b', 'c'], 'new', 'unit');
    expect(cfg.strips).toHaveLength(1);
    const axes = stripAxes(cfg, cfg.strips[0]!.id);
    expect(axes).toHaveLength(2);
    const ab = cfg.sigs.filter((s) => s.key !== 'c');
    expect(ab[0]!.axis).toBe(ab[1]!.axis);
    expect(cfg.axes[ab[0]!.axis]).toMatchObject({ min: expect.any(Number), name: 'V' });
    expect(cfg.axes[ab[0]!.axis]!.min).toBeLessThan(0.01);
    expect(cfg.axes[ab[0]!.axis]!.max).toBeGreaterThan(10);
  });

  it('can put everything on one common axis, or give each its own', () => {
    const common = addSignals(emptyConfig(), rec, ['a', 'c'], 'new', 'common');
    expect(new Set(common.sigs.map((s) => s.axis)).size).toBe(1);
    const own = addSignals(emptyConfig(), rec, ['a', 'b', 'c'], 'new', 'individual');
    expect(new Set(own.sigs.map((s) => s.axis)).size).toBe(3);
  });

  it('puts two-state signals on strips of their own, below the analog ones', () => {
    const cfg = addSignals(addSignals(emptyConfig(), rec, ['d'], 'new', 'unit'), rec, ['a'], 'new', 'unit');
    expect(cfg.strips.map((s) => s.kind)).toEqual(['analog', 'bool']);
    expect(cfg.sigs.find((s) => s.key === 'd')!.axis).toBe(NO_AXIS);
  });

  it('ignores unknown signals and signals already shown', () => {
    const once = addSignals(emptyConfig(), rec, ['a'], 'new', 'unit');
    expect(addSignals(once, rec, ['a', 'zzz'], 'new', 'unit').sigs).toHaveLength(1);
  });

  it('adds to an existing strip', () => {
    const one = addSignals(emptyConfig(), rec, ['a'], 'new', 'unit');
    const two = addSignals(one, rec, ['c'], one.strips[0]!.id, 'individual');
    expect(two.strips).toHaveLength(1);
    expect(two.sigs).toHaveLength(2);
  });
});

describe('axes', () => {
  const cfg = addSignals(emptyConfig(), rec, ['a', 'b'], 'new', 'individual');
  const [sa, sb] = cfg.sigs;
  it('shares an axis and splits it again', () => {
    const shared = shareAxis(cfg, [sa!.id, sb!.id]);
    expect(shared.sigs[0]!.axis).toBe(shared.sigs[1]!.axis);
    expect(Object.keys(shared.axes)).toHaveLength(1);
    const split = splitAxes(shared, [sa!.id, sb!.id]);
    expect(split.sigs[0]!.axis).not.toBe(split.sigs[1]!.axis);
    expect(Object.keys(split.axes)).toHaveLength(2);
  });
  it('sets a range, and refuses an empty one', () => {
    const axis = cfg.sigs[0]!.axis;
    expect(setAxis(cfg, axis, { min: -1, max: 5 }).axes[axis]).toMatchObject({ min: -1, max: 5 });
    expect(setAxis(cfg, axis, { min: 5, max: 5 })).toBe(cfg);
  });
  it('fits an axis to its signals over a range', () => {
    const axis = cfg.sigs[1]!.axis;
    const zoomed = setAxis(cfg, axis, { min: 100, max: 200 });
    const fit = fitAxes(zoomed, rec, [axis], 0, 2);
    expect(fit.axes[axis]!.min).toBeLessThan(2);
    expect(fit.axes[axis]!.max).toBeGreaterThan(4);
  });
});

describe('moving and removing', () => {
  it('moving a signal to a new strip keeps its style and drops the strip it left when that is empty', () => {
    const cfg = addSignals(emptyConfig(), rec, ['a'], 'new', 'unit');
    const styled = { ...cfg, sigs: [{ ...cfg.sigs[0]!, color: 4, width: 3 }] };
    const moved = moveSignals(styled, rec, [styled.sigs[0]!.id], 'new', 'individual');
    expect(moved.strips).toHaveLength(1);
    expect(moved.sigs[0]).toMatchObject({ color: 4, width: 3 });
  });
  it('removing the last signal of an axis removes the axis', () => {
    const cfg = addSignals(emptyConfig(), rec, ['a', 'c'], 'new', 'individual');
    const r = removeSignals(cfg, [cfg.sigs[0]!.id]);
    expect(Object.keys(r.axes)).toHaveLength(1);
  });
  it('deletes and reorders strips', () => {
    let cfg = addSignals(emptyConfig(), rec, ['a'], 'new', 'unit');
    cfg = addSignals(cfg, rec, ['c'], 'new', 'unit');
    const [s1, s2] = cfg.strips;
    expect(moveStrip(cfg, s2!.id, -1).strips[0]!.id).toBe(s2!.id);
    expect(moveStrip(cfg, s1!.id, -1)).toBe(cfg);
    const del = deleteStrip(cfg, s1!.id);
    expect(del.strips).toHaveLength(1);
    expect(del.sigs).toHaveLength(1);
  });
});

describe('cursors', () => {
  it('adds A, then B, then clears', () => {
    let cfg = emptyConfig();
    cfg = cycleCursors(cfg, [0, 10]);
    expect(cfg.cur.a?.t).toBeCloseTo(2.5);
    cfg = cycleCursors(cfg, [0, 10]);
    expect(cfg.cur.b?.t).toBeCloseTo(7.5);
    expect(cfg.cur.active).toBe('b');
    cfg = cycleCursors(cfg, [0, 10]);
    expect(cfg.cur.a).toBeUndefined();
    expect(cfg.cur.b).toBeUndefined();
  });
  it('an anchored cursor keeps its place on screen when the view moves', () => {
    const cfg = { ...emptyConfig(), cur: { a: { t: 5, anchor: 0.5 }, active: 'a' as const } };
    expect(applyAnchors(cfg, [10, 20]).cur.a!.t).toBe(15);
    expect(applyAnchors({ ...cfg, cur: { a: { t: 5 }, active: 'a' } }, [10, 20]).cur.a!.t).toBe(5);
  });
  it('moving an anchored cursor updates where it is anchored', () => {
    const cfg = { ...emptyConfig(), cur: { a: { t: 5, anchor: 0.5 }, active: 'a' as const } };
    expect(setCursor(cfg, 'a', 12, [10, 20]).cur.a).toEqual({ t: 12, anchor: 0.2 });
  });
});

describe('reading settings from a project file', () => {
  it('round-trips', () => {
    const cfg = addSignals(emptyConfig('r1'), rec, ['a', 'c', 'd'], 'new', 'unit');
    expect(parseConfig(JSON.parse(JSON.stringify(cfg)))).toEqual({ ...cfg, view: undefined });
  });
  it('keeps calculated signals only while a signal uses them, and checks their keys', () => {
    const cfg = addSignals(emptyConfig('r1'), rec, ['a'], 'new', 'unit');
    const withCalc = { ...cfg, calcs: [{ key: 'calc:abc', label: 'P', unit: 'W', formula: 'a * 2' }], sigs: [...cfg.sigs, { ...cfg.sigs[0]!, id: 's2', key: 'calc:abc' }] };
    expect(parseConfig(JSON.parse(JSON.stringify(withCalc))).calcs).toHaveLength(1);
    expect(removeSignals(withCalc, ['s2']).calcs).toHaveLength(0);
    const bad = JSON.parse(JSON.stringify(withCalc));
    bad.calcs.push({ key: 'evil key', label: 'x', unit: '', formula: '1' });
    expect(parseConfig(bad).calcs).toHaveLength(1);
  });
  it('drops signals whose strip or axis is missing, and unused axes', () => {
    const cfg = addSignals(emptyConfig('r1'), rec, ['a'], 'new', 'unit');
    const bad = JSON.parse(JSON.stringify(cfg));
    bad.sigs.push({ id: 'x', key: 'q', strip: 'nope', axis: 'nope', color: 1, width: 1, step: false, marks: true, visible: true });
    bad.axes.unused = { min: 0, max: 1 };
    const out = parseConfig(bad);
    expect(out.sigs).toHaveLength(1);
    expect(Object.keys(out.axes)).toHaveLength(1);
  });
  it('repairs bad numbers instead of failing', () => {
    const cfg = addSignals(emptyConfig('r1'), rec, ['a'], 'new', 'unit');
    const bad = JSON.parse(JSON.stringify(cfg));
    bad.sigs[0].width = 9999;
    bad.sigs[0].color = 99;
    bad.view = [5, 1];
    const out = parseConfig(bad);
    expect(out.sigs[0]).toMatchObject({ width: 1.75, color: 1 });
    expect(out.view).toBeUndefined();
  });
  it('accepts nothing from junk', () => {
    expect(parseConfig(null)).toEqual(emptyConfig());
    expect(parseConfig('x')).toEqual(emptyConfig());
  });
});
