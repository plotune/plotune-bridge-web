import { describe, expect, it } from 'vitest';
import { NO_FILTER, filterActive, formatTraceData, formatTraceId, frameMatches, rowMatches } from '../src/lib/traceFilter';
import { TraceBuffer } from '../src/state/trace';
import { formatElapsed } from '../src/App';
import type { CanFrame } from '../src/protocol/types';

const frame = (over: Partial<CanFrame> = {}): CanFrame => ({ channel: 1, id: 0x7e8, extended: false, rtr: false, dlc: 3, data: new Uint8Array([0x62, 0xf1, 0x90]), timestampNs: 1n, direction: 'rx', ...over });

describe('trace filter', () => {
  it('matches ID as hex or decimal and data with or without spaces', () => {
    expect(frameMatches(frame(), { ...NO_FILTER, text: '7e8' })).toBe(true);
    expect(frameMatches(frame(), { ...NO_FILTER, text: '0x7E8' })).toBe(true);
    expect(frameMatches(frame(), { ...NO_FILTER, text: '2024' })).toBe(true);
    expect(frameMatches(frame(), { ...NO_FILTER, text: '62 f1' })).toBe(true);
    expect(frameMatches(frame(), { ...NO_FILTER, text: '62f1' })).toBe(true);
    expect(frameMatches(frame(), { ...NO_FILTER, text: '123' })).toBe(false);
  });

  it('filters by channel and direction together', () => {
    expect(frameMatches(frame({ channel: 2 }), { ...NO_FILTER, channel: 1 })).toBe(false);
    expect(frameMatches(frame({ direction: 'tx' }), { ...NO_FILTER, direction: 'rx' })).toBe(false);
    expect(frameMatches(frame(), { ...NO_FILTER, channel: 1, direction: 'rx' })).toBe(true);
    expect(filterActive(NO_FILTER)).toBe(false);
    expect(filterActive({ ...NO_FILTER, text: ' ' })).toBe(false);
    expect(filterActive({ ...NO_FILTER, channel: 1 })).toBe(true);
  });

  it('never hides a loss marker, whatever the filter says', () => {
    const f = { ...NO_FILTER, text: 'zzzz' };
    expect(rowMatches({ kind: 'drop', key: 1, channel: 1, count: 5 }, f)).toBe(true);
    expect(rowMatches({ kind: 'gap', key: 2, batches: 1 }, f)).toBe(true);
    expect(rowMatches({ kind: 'frame', key: 3, frame: frame() }, f)).toBe(false);
  });

  it('formats IDs and data in hex or decimal', () => {
    expect(formatTraceId(0x7e8, false, 'hex')).toBe('7E8');
    expect(formatTraceId(0x7e8, false, 'dec')).toBe('2024');
    expect(formatTraceData(new Uint8Array([0x0a, 0xff]), 'hex')).toBe('0A FF');
    expect(formatTraceData(new Uint8Array([0x0a, 0xff]), 'dec')).toBe('10 255');
  });
});

describe('TraceBuffer frame count', () => {
  it('counts only frames, through eviction and clear', () => {
    const buf = new TraceBuffer(64);
    buf.push({ kind: 'session', text: 'Connected' });
    expect(buf.frameCount).toBe(0);
    for (let i = 0; i < 200; i += 1) buf.push({ kind: 'frame', frame: frame({ timestampNs: BigInt(i) }) });
    expect(buf.frameCount).toBe(buf.length - 0 - (buf.at(0).kind === 'session' ? 1 : 0));
    buf.clear();
    expect(buf.frameCount).toBe(0);
  });
});

describe('elapsed time', () => {
  it('formats hh:mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00:00');
    expect(formatElapsed(65_900)).toBe('00:01:05');
    expect(formatElapsed(3_661_000)).toBe('01:01:01');
    expect(formatElapsed(-5)).toBe('00:00:00');
  });
});
