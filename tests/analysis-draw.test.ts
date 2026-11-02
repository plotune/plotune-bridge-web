import { describe, expect, it } from 'vitest';
import { AXIS_WIDTH, BOOL_HEIGHT, hitTest, layout, timeToX, xToTime } from '../src/analysis/draw';
import type { Recording, SignalData } from '../src/analysis/math';
import { addSignals, emptyConfig, setCursor } from '../src/analysis/model';

const sig = (key: string, unit: string, bool = false): SignalData => ({ key, label: key, unit, decimals: 2, bool, t: Float64Array.from([0, 5, 10]), v: Float64Array.from([0, bool ? 1 : 5, 10]) });
const rec: Recording = { id: 'r', name: 'R', created: 0, source: 'import', duration: 10, events: [{ t: 5, label: 'Event', kind: 'info' }], signals: { a: sig('a', 'V'), b: sig('b', 'rpm'), c: sig('c', 'A'), d: sig('d', '', true) } };
const cfg = addSignals(addSignals(emptyConfig('r'), rec, ['a', 'b', 'c'], 'new', 'individual'), rec, ['d'], 'new', 'unit');

describe('Analyzer geometry', () => {
  const g = layout(cfg, rec, 800, 600);
  it('leaves room for every y axis of the busiest strip', () => {
    expect(g.px0).toBe(3 * AXIS_WIDTH + 4);
    expect(g.px1).toBeLessThanOrEqual(800);
  });
  it('stacks the strips without overlap and gives two-state strips a fixed height', () => {
    expect(g.strips).toHaveLength(2);
    const [analog, bool] = g.strips;
    expect(analog!.y1).toBeLessThan(bool!.y0);
    expect(bool!.y1 - bool!.y0).toBe(BOOL_HEIGHT);
    expect(g.events).not.toBeNull();
    expect(g.events!.y0).toBeGreaterThan(bool!.y1);
    expect(g.slider.y1).toBeLessThanOrEqual(600);
    expect(g.time.y1).toBeLessThan(g.slider.y0 + 1);
  });
  it('maps time to the plot and back', () => {
    const view: [number, number] = [2, 6];
    expect(timeToX(g, view, 2)).toBeCloseTo(g.px0);
    expect(timeToX(g, view, 6)).toBeCloseTo(g.px1);
    expect(xToTime(g, view, timeToX(g, view, 4.2))).toBeCloseTo(4.2);
  });
});

describe('Analyzer hit testing', () => {
  const g = layout(cfg, rec, 800, 600);
  const view: [number, number] = [0, 10];
  const strip = g.strips[0]!;
  const mid = (strip.y0 + strip.y1) / 2;
  it('tells axes, the plot, the slider and the event strip apart', () => {
    expect(hitTest(g, cfg, rec, view, g.px0 - 10, mid)).toMatchObject({ region: 'axis' });
    expect(hitTest(g, cfg, rec, view, g.px0 - 10 - 2 * AXIS_WIDTH, mid)).toMatchObject({ region: 'axis' });
    expect(hitTest(g, cfg, rec, view, (g.px0 + g.px1) / 2, mid)).toMatchObject({ region: 'plot' });
    expect(hitTest(g, cfg, rec, view, (g.px0 + g.px1) / 2, (g.slider.y0 + g.slider.y1) / 2)).toMatchObject({ region: 'slider', part: 'window' });
    expect(hitTest(g, cfg, rec, view, timeToX(g, view, 5), (g.events!.y0 + g.events!.y1) / 2)).toEqual({ region: 'event', index: 0 });
    // Two-state strips have no axis to grab.
    const bool = g.strips[1]!;
    expect(hitTest(g, cfg, rec, view, g.px0 - 10, (bool.y0 + bool.y1) / 2)).toEqual({ region: 'none' });
  });
  it('finds the edges of the slider window when zoomed in', () => {
    const zoomed: [number, number] = [2, 6];
    const y = (g.slider.y0 + g.slider.y1) / 2;
    const left = g.px0 + (2 / 10) * (g.px1 - g.px0);
    expect(hitTest(g, cfg, rec, zoomed, left, y)).toMatchObject({ region: 'slider', part: 'left' });
    expect(hitTest(g, cfg, rec, zoomed, g.px1 - 3, y)).toMatchObject({ region: 'slider', part: 'track' });
  });
  it('a cursor takes a grab on its own line before the plot does', () => {
    const c = setCursor(cfg, 'a', 4, view);
    expect(hitTest(g, c, rec, view, timeToX(g, view, 4) + 2, mid)).toEqual({ region: 'cursor', which: 'a' });
    expect(hitTest(g, c, rec, view, timeToX(g, view, 4) + 30, mid)).toMatchObject({ region: 'plot' });
  });
});
