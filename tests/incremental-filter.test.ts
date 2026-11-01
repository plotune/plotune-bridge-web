import { describe, expect, it } from 'vitest';
import { IncrementalFilter } from '../src/lib/incrementalFilter';
import { NO_FILTER, rowMatches, type TraceFilter } from '../src/lib/traceFilter';
import { TraceBuffer } from '../src/state/trace';
import type { CanFrame } from '../src/protocol/types';

function frame(i: number, channel = 1 + (i % 2)): CanFrame {
  return { channel, id: 0x100 + (i % 7), extended: false, rtr: false, dlc: 2, data: Uint8Array.of(i & 255, 0xaa), timestampNs: BigInt(i), direction: i % 3 === 0 ? 'tx' : 'rx' };
}
const names = (f: CanFrame) => (f.id % 2 === 0 ? 'even message' : 'odd message');

/** What a full re-scan would answer: the reference the incremental answer must always equal. */
function naive(trace: TraceBuffer, filter: TraceFilter): number[] {
  const out: number[] = [];
  for (let i = 0; i < trace.length; i += 1) if (rowMatches(trace.at(i), filter, names)) out.push(i);
  return out;
}

describe('IncrementalFilter', () => {
  it('equals a full re-scan through appends, markers, eviction, clear and filter changes', () => {
    const trace = new TraceBuffer(10); // small, so rows are evicted in chunks (the buffer trims after 64 extra rows)
    const inc = new IncrementalFilter();
    let filter: TraceFilter = { ...NO_FILTER, text: 'even' };
    let seed = 1;
    let sawEviction = false;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let step = 0; step < 600; step += 1) {
      const roll = rand();
      if (roll < 0.01) trace.clear();
      else if (roll < 0.06) trace.push({ kind: 'drop', channel: 1, count: 3 });
      else if (roll < 0.1) filter = { ...NO_FILTER, text: ['even', 'odd', '', '102', 'aa'][Math.floor(rand() * 5)], channel: rand() < 0.3 ? 2 : null, direction: rand() < 0.2 ? 'tx' : null };
      else for (let k = 0; k < 1 + Math.floor(rand() * 14); k += 1) trace.push({ kind: 'frame', frame: frame(step * 10 + k) });
      if (trace.evicted > 0) sawEviction = true;
      expect(inc.update(trace, filter, names, names), `step ${step}`).toEqual(naive(trace, filter));
    }
    expect(sawEviction).toBe(true); // eviction was really exercised
  });

  it('starts over when the names change (a database was loaded or removed)', () => {
    const trace = new TraceBuffer(100);
    for (let i = 0; i < 20; i += 1) trace.push({ kind: 'frame', frame: frame(i) });
    const inc = new IncrementalFilter();
    const filter = { ...NO_FILTER, text: 'even' };
    expect(inc.update(trace, filter, undefined, 'none')).toEqual([]);
    expect(inc.update(trace, filter, names, 'db').length).toBeGreaterThan(0);
    expect(inc.update(trace, filter, undefined, 'none')).toEqual([]);
  });

  it('only examines rows that arrived since the last call', () => {
    const trace = new TraceBuffer(1000);
    for (let i = 0; i < 500; i += 1) trace.push({ kind: 'frame', frame: frame(i) });
    const inc = new IncrementalFilter();
    let calls = 0;
    const counting = (f: CanFrame) => {
      calls += 1;
      return names(f);
    };
    const filter = { ...NO_FILTER, text: 'even' };
    inc.update(trace, filter, counting, 'k');
    const first = calls;
    for (let i = 500; i < 510; i += 1) trace.push({ kind: 'frame', frame: frame(i) });
    inc.update(trace, filter, counting, 'k');
    expect(calls - first).toBeLessThanOrEqual(10);
  });
});
