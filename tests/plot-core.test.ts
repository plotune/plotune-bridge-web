import { describe, expect, it } from 'vitest';
import { decodeMessage, decodeSelected } from '../src/dbc/decode';
import { DbcRegistry } from '../src/dbc/registry';
import { MAX_SPAN_S, MIN_SPAN_S, buildPath, formatTick, niceTicks, valueRange, zoomedRange } from '../src/plot/geometry';
import { Series, SeriesStore, type SignalKey } from '../src/plot/series';
import { TraceBuffer } from '../src/state/trace';
import type { CanFrame } from '../src/protocol/types';

const DBC = `BO_ 2024 Resp: 2 X
 SG_ Counter : 0|8@1+ (1,0) [0|255] "" Y
 SG_ Level : 8|8@1+ (0.5,-10) [-10|117.5] "degC" Y
BO_ 100 Mux: 2 X
 SG_ Sel M : 0|4@1+ (1,0) [0|15] "" Y
 SG_ A m0 : 8|8@1+ (1,0) [0|255] "" Y
 SG_ B m1 : 8|8@1+ (2,0) [0|510] "" Y
BO_ 200 Big: 2 X
 SG_ Motor : 7|16@0+ (1,0) [0|65535] "" Y
`;

const key = (over: Partial<SignalKey> = {}): SignalKey => ({ channel: 1, id: 2024, extended: false, signal: 'Counter', messageName: 'Resp', unit: '', ...over });
const frame = (i: number, over: Partial<CanFrame> = {}): CanFrame => ({ channel: 1, id: 2024, extended: false, rtr: false, dlc: 2, data: Uint8Array.of(i & 255, 100), timestampNs: 1_000_000_000n + BigInt(i) * 10_000_000n, direction: 'rx', ...over });
function setup() {
  const registry = new DbcRegistry();
  registry.assign(1, 'a.dbc', DBC);
  return { registry, trace: new TraceBuffer(200_000), store: new SeriesStore(1000) };
}

describe('decodeSelected', () => {
  it('equals the matching entries of decodeMessage, including multiplexing, on random frames', () => {
    const { registry } = setup();
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255;
    for (const id of [2024, 100, 200]) {
      const message = registry.message(1, id, false)!;
      for (let n = 0; n < 200; n += 1) {
        const data = Uint8Array.from({ length: 2 }, rnd);
        const names = new Set(message.signals.filter((_, i) => (n + i) % 2 === 0).map((s) => s.name));
        const expected = decodeMessage(message, data).filter((s) => names.has(s.name));
        expect(decodeSelected(message, data, names), `${id} ${[...data]}`).toEqual(expected);
      }
    }
  });
});

describe('Series', () => {
  it('keeps the newest points when full, and finds times with a binary search', () => {
    const s = new Series(key(), 5);
    for (let i = 0; i < 12; i += 1) s.push(i, i * 10);
    expect(s.length).toBe(5);
    expect([s.timeAt(0), s.timeAt(4)]).toEqual([7, 11]);
    expect(s.lowerBound(9)).toBe(2);
    expect(s.lowerBound(99)).toBe(5);
    expect(s.nearest(9.4)).toEqual({ time: 9, value: 90 });
    expect(s.nearest(-5)).toEqual({ time: 7, value: 70 });
    expect(new Series(key(), 3).nearest(1)).toBeNull();
  });
});

describe('SeriesStore', () => {
  it('reads decoded, scaled samples on the device clock from its first frame, and only new rows afterwards', () => {
    const { registry, trace, store } = setup();
    const [counter, level] = store.sync([key(), key({ signal: 'Level', unit: 'degC' })]);
    for (let i = 0; i < 5; i += 1) trace.push({ kind: 'frame', frame: frame(i) });
    store.update(trace, registry, 'db');
    expect(counter.length).toBe(5);
    expect([counter.timeAt(0), counter.timeAt(4), counter.valueAt(3)]).toEqual([0, 0.04, 3]);
    expect(level.valueAt(0)).toBe(100 * 0.5 - 10); // factor and offset from the database
    for (let i = 5; i < 8; i += 1) trace.push({ kind: 'frame', frame: frame(i) });
    store.update(trace, registry, 'db');
    expect(counter.length).toBe(8); // no duplicates
  });

  it('ignores other messages, other channels and remote frames', () => {
    const { registry, trace, store } = setup();
    const [counter] = store.sync([key()]);
    trace.push({ kind: 'frame', frame: frame(1, { id: 999 }) });
    trace.push({ kind: 'frame', frame: frame(2, { channel: 2 }) });
    trace.push({ kind: 'frame', frame: frame(3, { rtr: true }) });
    trace.push({ kind: 'drop', channel: 1, count: 4 });
    trace.push({ kind: 'frame', frame: frame(4) });
    store.update(trace, registry, 'db');
    expect(counter.length).toBe(1);
    expect(counter.valueAt(0)).toBe(4);
  });

  it('follows multiplexing', () => {
    const { registry, trace, store } = setup();
    const [a, b] = store.sync([key({ id: 100, signal: 'A' }), key({ id: 100, signal: 'B' })]);
    trace.push({ kind: 'frame', frame: frame(0, { id: 100, data: Uint8Array.of(0, 7) }) });
    trace.push({ kind: 'frame', frame: frame(1, { id: 100, data: Uint8Array.of(1, 7) }) });
    store.update(trace, registry, 'db');
    expect([a.length, a.valueAt(0), b.length, b.valueAt(0)]).toEqual([1, 7, 1, 14]);
  });

  it('keeps samples when rows leave the trace, starts over on clear, and re-reads for a newly chosen signal without duplicates', () => {
    const { registry, store } = setup();
    const trace = new TraceBuffer(10); // small: rows are evicted
    const [counter] = store.sync([key()]);
    for (let i = 0; i < 300; i += 1) {
      trace.push({ kind: 'frame', frame: frame(i) });
      if (i % 50 === 49) store.update(trace, registry, 'db');
    }
    expect(trace.evicted).toBeGreaterThan(0);
    // Samples already read stay although the trace dropped those rows; rows evicted before a read are counted, never silent.
    expect(counter.length + store.missed).toBe(300);
    expect(store.missed).toBeGreaterThan(0);
    store.sync([key()]);
    trace.clear();
    store.update(trace, registry, 'db');
    expect(counter.length).toBe(0);
    expect(store.missed).toBe(0);
    for (let i = 0; i < 20; i += 1) trace.push({ kind: 'frame', frame: frame(i) });
    store.update(trace, registry, 'db');
    const [again, level] = store.sync([key(), key({ signal: 'Level' })]);
    store.update(trace, registry, 'db');
    expect([again.length, level.length]).toEqual([20, 20]); // both complete, nothing duplicated
  });

  it('loses nothing when it keeps up with the trace', () => {
    const { registry, store } = setup();
    const trace = new TraceBuffer(100); // keeps far more than one update interval, like the real 20,000-row buffer
    const [counter] = store.sync([key()]);
    for (let i = 0; i < 400; i += 1) {
      trace.push({ kind: 'frame', frame: frame(i) });
      if (i % 20 === 19) store.update(trace, registry, 'db');
    }
    expect(trace.evicted).toBeGreaterThan(0);
    expect([counter.length, store.missed]).toEqual([400, 0]);
  });

  it('stops at a freeze position, then catches up', () => {
    const { registry, trace, store } = setup();
    const [counter] = store.sync([key()]);
    for (let i = 0; i < 10; i += 1) trace.push({ kind: 'frame', frame: frame(i) });
    const end = trace.evicted + trace.length;
    for (let i = 10; i < 25; i += 1) trace.push({ kind: 'frame', frame: frame(i) });
    store.update(trace, registry, 'db', end);
    expect(counter.length).toBe(10);
    store.update(trace, registry, 'db');
    expect(counter.length).toBe(25);
  });

  it('starts over when the database changes', () => {
    const { registry, trace, store } = setup();
    const [counter] = store.sync([key()]);
    for (let i = 0; i < 5; i += 1) trace.push({ kind: 'frame', frame: frame(i) });
    store.update(trace, registry, 'db-1');
    store.update(trace, registry, 'db-2');
    expect(counter.length).toBe(5);
  });
});

describe('buildPath', () => {
  it('uses the points as they are when there are few', () => {
    const s = new Series(key(), 100);
    for (let i = 0; i < 10; i += 1) s.push(i, i);
    const p = buildPath(s, 2, 6, 500);
    expect([...p.t]).toEqual([1, 2, 3, 4, 5, 6, 7]); // one point either side so the line enters and leaves the window
  });

  it('never loses a spike when it reduces many points to the pixel width, and stays small', () => {
    const s = new Series(key(), 50_000);
    for (let i = 0; i < 40_000; i += 1) s.push(i / 1000, i === 21_345 ? 1000 : i === 30_001 ? -500 : Math.sin(i / 50));
    const width = 600;
    const p = buildPath(s, 0, 40, width);
    expect(p.count).toBeLessThanOrEqual(width * 4);
    expect(Math.max(...p.v)).toBe(1000);
    expect(Math.min(...p.v)).toBe(-500);
    for (let i = 1; i < p.count; i += 1) expect(p.t[i]).toBeGreaterThanOrEqual(p.t[i - 1]);
  });

  it('is empty for an empty series or a window with no points', () => {
    expect(buildPath(new Series(key(), 10), 0, 1, 100).count).toBe(0);
  });
});

describe('axes', () => {
  it('chooses round ticks and prints them without floating-point noise', () => {
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0.1, 0.35, 5)).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35]);
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(formatTick(0.30000000000000004)).toBe('0.3');
    expect(formatTick(0)).toBe('0');
  });
  it('pads the range, and gives a flat line room', () => {
    const s = new Series(key(), 10);
    s.push(0, 5);
    s.push(1, 5);
    expect(valueRange([buildPath(s, 0, 1, 100)], 0, 1)).toEqual({ min: 4, max: 6 });
    s.push(2, 7);
    const r = valueRange([buildPath(s, 0, 2, 100)], 0, 2)!;
    expect(r.min).toBeLessThan(5);
    expect(r.max).toBeGreaterThan(7);
    expect(valueRange([], 0, 1)).toBeNull();
  });
});

describe('zoomedRange', () => {
  it('halves or doubles the span around a point and keeps that point at the same place in the window', () => {
    expect(zoomedRange(0, 10, 5, 0.5)).toEqual({ t0: 2.5, t1: 7.5 });
    expect(zoomedRange(10, 20, 12, 0.5)).toEqual({ t0: 11, t1: 16 }); // 12 sits at 20% of the window before and after
    expect(zoomedRange(10, 20, 15, 2)).toEqual({ t0: 5, t1: 25 });
  });
  it('never goes below 50 ms or above an hour, and never starts before time zero', () => {
    const tiny = zoomedRange(1, 1.06, 1.03, 0.1);
    expect(tiny.t1 - tiny.t0).toBeCloseTo(MIN_SPAN_S, 9);
    const huge = zoomedRange(0, 3000, 1500, 10);
    expect(huge.t1 - huge.t0).toBe(MAX_SPAN_S);
    expect(zoomedRange(1, 3, 2, 2).t0).toBe(0);
    expect(zoomedRange(1, 3, 1, 2)).toEqual({ t0: 1, t1: 5 }); // centred on the left edge: the start stays
    expect(zoomedRange(0, 0, 0, 0.5).t1).toBeGreaterThan(0);
  });
  it('keeps a dragged range as chosen', () => {
    expect(zoomedRange(4, 6, 5, 1)).toEqual({ t0: 4, t1: 6 });
  });
});
