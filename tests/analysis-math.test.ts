import { describe, expect, it } from 'vitest';
import { evaluate, FormulaError, parseFormula } from '../src/analysis/expression';
import { clampView, decimalsForStep, fitRange, lowerBound, nearestSample, rangeStats, reduceColumns, stepSample, ticks, valueAt, zoomAbout, type SignalData } from '../src/analysis/math';

const sig = (t: number[], v: number[], extra: Partial<SignalData> = {}): SignalData => ({ key: 'k', label: 'K', unit: 'V', decimals: 2, bool: false, t: Float64Array.from(t), v: Float64Array.from(v), ...extra });

describe('reading values', () => {
  const s = sig([0, 1, 2, 3], [0, 10, 20, 10]);
  it('finds the first sample at or after a time', () => {
    expect(lowerBound(s.t, 1.5)).toBe(2);
    expect(lowerBound(s.t, 99)).toBe(4);
  });
  it('interpolates analog signals and steps two-state ones', () => {
    expect(valueAt(s, 1.5)).toBeCloseTo(15);
    expect(valueAt(s, 2)).toBe(20);
    expect(valueAt(sig([0, 1], [0, 1], { bool: true }), 0.9)).toBe(0);
  });
  it('has no value outside the data', () => {
    expect(valueAt(s, -1)).toBeNull();
    expect(valueAt(s, 3.1)).toBeNull();
  });
  it('snaps a cursor to the nearest sample and steps between samples', () => {
    expect(nearestSample(s, 1.4)).toBe(1);
    expect(nearestSample(s, 1.6)).toBe(2);
    expect(stepSample(s, 1, 1)).toBe(2);
    expect(stepSample(s, 1, -1)).toBe(0);
    expect(stepSample(s, 3, 1)).toBeNull();
    expect(stepSample(s, 0, -1)).toBeNull();
  });
});

describe('statistics and fitting', () => {
  const s = sig([0, 1, 2, 3, 4], [2, 4, 4, 4, 6]);
  it('summarises a range', () => {
    const st = rangeStats(s, 1, 3)!;
    expect(st).toMatchObject({ count: 3, min: 4, max: 4, avg: 4, std: 0 });
    const all = rangeStats(s, 0, 4)!;
    expect(all.avg).toBeCloseTo(4);
    expect(all.std).toBeCloseTo(Math.sqrt(1.6));
  });
  it('returns nothing for an empty range', () => {
    expect(rangeStats(s, 10, 20)).toBeNull();
  });
  it('fits a range with a little room, and handles a flat signal', () => {
    const r = fitRange([s], 0, 4)!;
    expect(r[0]).toBeLessThan(2);
    expect(r[1]).toBeGreaterThan(6);
    const flat = fitRange([sig([0, 1], [5, 5])], 0, 1)!;
    expect(flat[0]).toBeLessThan(5);
    expect(flat[1]).toBeGreaterThan(5);
    expect(fitRange([s], 100, 200)).toBeNull();
  });
});

describe('reducing to pixel columns', () => {
  it('keeps the extremes of each column', () => {
    const t = Array.from({ length: 100 }, (_, i) => i / 10);
    const v = t.map((x) => (Math.round(x * 10) % 10 === 5 ? 100 : 1));
    const c = reduceColumns(sig(t, v), 0, 10, 10);
    expect(Array.from(c.max)).toEqual(Array(10).fill(100));
    expect(Array.from(c.min)).toEqual(Array(10).fill(1));
    expect(c.density).toBe(10);
  });
  it('marks empty columns', () => {
    const c = reduceColumns(sig([0, 9.9], [1, 2]), 0, 10, 10);
    expect(Number.isNaN(c.min[5]!)).toBe(true);
    expect(c.first[0]).toBe(1);
    expect(c.last[9]).toBe(2);
  });
});

describe('ticks and views', () => {
  it('makes round ticks', () => {
    const t = ticks(0, 97, 5);
    expect(t.step).toBe(20);
    expect(t.values).toEqual([0, 20, 40, 60, 80]);
    expect(decimalsForStep(0.05)).toBe(2);
    expect(decimalsForStep(20)).toBe(0);
  });
  it('keeps a view inside the recording and not narrower than allowed', () => {
    expect(clampView([-5, 5], [0, 100], 1)).toEqual([0, 10]);
    expect(clampView([95, 120], [0, 100], 1)).toEqual([75, 100]);
    expect(clampView([10, 10.01], [0, 100], 1)[1]! - 10).toBeCloseTo(1);
  });
  it('zooms around a time and keeps it under the pointer', () => {
    const v = zoomAbout([0, 100], 25, 0.5, [0, 100], 1);
    expect(v).toEqual([12.5, 62.5]);
  });
});

describe('calculated signals', () => {
  const a = sig([0, 1, 2, 3], [1, 2, 3, 4], { key: 'a' });
  const b = sig([0, 2], [10, 20], { key: 'b' });
  const inputs = new Map([['A', a], ['B', b]]);
  it('does arithmetic with the usual precedence', () => {
    expect(Array.from(evaluate('A * 2 + 1', inputs).v)).toEqual([3, 5, 7, 9]);
    expect(Array.from(evaluate('-(A - 1) * 3', inputs).v)).toEqual([0, -3, -6, -9]);
  });
  it('steps other inputs on the time base of the first', () => {
    expect(Array.from(evaluate('A + B', inputs).v)).toEqual([11, 12, 23, 24]);
  });
  it('supports a few functions', () => {
    expect(Array.from(evaluate('max(A, 2.5)', inputs).v)).toEqual([2.5, 2.5, 3, 4]);
    expect(Array.from(evaluate('sqrt(A * A)', inputs).v)).toEqual([1, 2, 3, 4]);
  });
  it('explains what is wrong', () => {
    expect(() => parseFormula('A +')).toThrow(FormulaError);
    expect(() => parseFormula('A $ 2')).toThrow(/Unexpected character/);
    expect(() => parseFormula('exit(1)')).toThrow(/not a function/);
    expect(() => evaluate('Z + 1', inputs)).toThrow(/no signal called “Z”/);
    expect(() => evaluate('1 + 2', inputs)).toThrow(/at least one signal/);
    expect(() => parseFormula('((((((((((((((((((((((((((((((((((((((((((A))))))))))))))))))))))))))))))))))))))))))')).toThrow(/nested/);
  });
  it('skips points where the result is not a number', () => {
    expect(evaluate('1 / (A - 2)', inputs).t.length).toBe(3);
  });
});
