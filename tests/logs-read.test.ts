import { describe, expect, it } from 'vitest';
import { buildBlfBytes, blfCanMessage } from '../src/record/blf';
import { FORMATS } from '../src/record/formats';
import { LogError, parseAsc, parseBlf, parseCandump } from '../src/logs/read';
import type { CanFrame } from '../src/protocol/types';

const frame = (over: Partial<CanFrame>): CanFrame => ({ channel: 1, id: 0x7e8, extended: false, rtr: false, dlc: 2, data: Uint8Array.of(1, 0xaa), direction: 'rx', timestampNs: 0n, ...over } as CanFrame);

describe('reading logs', () => {
  it('reads what the recorder writes as ASC, with extended ids, channels and remote frames', () => {
    const asc = FORMATS.find((f) => f.id === 'asc')!;
    const text = asc.header(new Date()) + asc.line(frame({}), '0.000000') + asc.line(frame({ channel: 2, id: 0x18daf110, extended: true, dlc: 4, data: Uint8Array.of(0xde, 0xad, 0xbe, 0xef) }), '0.500000') + asc.line(frame({ id: 0x7ff, rtr: true, dlc: 0, data: new Uint8Array() }), '1.000000');
    const log = parseAsc(text);
    expect(log.frames.count).toBe(3);
    expect([...log.channels]).toEqual([[1, 2], [2, 1]]);
    expect(log.frames.id[1]).toBe(0x18daf110);
    expect(log.frames.extended[1]).toBe(1);
    expect(Array.from(log.frames.data.subarray(8, 12))).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(log.frames.rtr[2]).toBe(1);
    expect(log.duration).toBeCloseTo(1, 6);
  });
  it('reads candump, with can0 as channel 1', () => {
    const log = parseCandump('(10.000000) can0 7E8#01AA\n(10.250000) can1 18DAF110#DEADBEEF\n(10.500000) can0 7FF#R\n');
    expect(log.frames.count).toBe(3);
    expect([...log.channels.keys()]).toEqual([1, 2]);
    expect(log.frames.extended[1]).toBe(1);
    expect(log.frames.t[1]).toBeCloseTo(0.25, 6);
  });
  it('reads BLF containers written by the recorder', async () => {
    const objects = [blfCanMessage(frame({}), 0n), blfCanMessage(frame({ channel: 2, id: 0x18daf110, extended: true, dlc: 4, data: Uint8Array.of(9, 8, 7, 6) }), 500_000_000n)];
    const log = await parseBlf(await buildBlfBytes(objects, new Date(), new Date()));
    expect(log.frames.count).toBe(2);
    expect([...log.channels]).toEqual([[1, 1], [2, 1]]);
    expect(log.frames.id[1]).toBe(0x18daf110);
    expect(log.frames.t[1]).toBeCloseTo(0.5, 6);
    expect(Array.from(log.frames.data.subarray(8, 12))).toEqual([9, 8, 7, 6]);
  });
  it('says so when a file holds no frames or is not a BLF', async () => {
    expect(() => parseAsc('nothing here')).toThrow(LogError);
    await expect(parseBlf(new Uint8Array(200))).rejects.toThrow(LogError);
  });
});
