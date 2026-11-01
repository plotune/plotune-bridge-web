import { describe, expect, it } from 'vitest';
import { FORMATS, formatSpec } from '../src/record/formats';
import { Recorder, RecordingService, recordingFileName } from '../src/record/recorder';
import type { CanFrame } from '../src/protocol/types';
import type { WorkspaceStore } from '../src/state/store';

const f = (over: Partial<CanFrame> = {}): CanFrame => ({ channel: 1, id: 0x123, extended: false, rtr: false, dlc: 4, data: Uint8Array.of(0x11, 0x22, 0x33, 0x44), timestampNs: 5_000_000_000n, direction: 'rx', ...over });
const START = new Date(2026, 10, 1, 14, 5, 9, 7);
const fixture = (r: Recorder) => {
  r.frame(f());
  r.drop(1, 3);
  r.frame(f({ channel: 2, id: 0x7e8, dlc: 8, data: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8), timestampNs: 5_010_000_000n, direction: 'tx' }));
  r.frame(f({ id: 0x18da10f1, extended: true, dlc: 2, data: Uint8Array.of(0xab, 0xcd), timestampNs: 5_020_500_000n }));
  r.frame(f({ id: 0x100, rtr: true, dlc: 3, data: new Uint8Array(0), timestampNs: 5_030_000_000n }));
  r.frame(f({ id: 0x7ff, dlc: 0, data: new Uint8Array(0), timestampNs: 5_040_000_001n, direction: 'tx' }));
};

describe('formats (byte exact; ASC and candump were also read back with python-can 4.6.1, CSV with Python csv)', () => {
  it('ASC', () => {
    const r = new Recorder('asc', START);
    fixture(r);
    expect(r.text()).toBe(
      [
        'date Sun Nov 1 02:05:09.007 pm 2026',
        'base hex  timestamps absolute',
        'internal events logged',
        '// Recorded by Plotune Bridge. Timestamps are the device clock in seconds from the first recorded frame.',
        '// version 9.0.0',
        '   0.000000 1  123             Rx   d 4 11 22 33 44',
        '// 0.000000 CAN 1: the device reported 3 lost frames here (their exact position is not known)',
        '   0.010000 2  7E8             Tx   d 8 01 02 03 04 05 06 07 08',
        '   0.020500 1  18DA10F1x       Rx   d 2 AB CD',
        '   0.030000 1  100             Rx   r 3',
        '   0.040000 1  7FF             Tx   d 0',
        '',
      ].join('\n'),
    );
  });

  it('candump log (device channel n is can(n-1); extended ids have 8 digits; remote frames end in R)', () => {
    const r = new Recorder('candump', START);
    fixture(r);
    expect(r.text()).toBe(['(0.000000) can0 123#11223344', '(0.010000) can1 7E8#0102030405060708', '(0.020500) can0 18DA10F1#ABCD', '(0.030000) can0 100#R', '(0.040000) can0 7FF#', ''].join('\n'));
  });

  it('CSV', () => {
    const r = new Recorder('csv', START);
    fixture(r);
    expect(r.text()).toBe(
      ['time_s,channel,id_hex,extended,direction,remote,dlc,data_hex', '0.000000,1,123,0,rx,0,4,11223344', '0.010000,2,7E8,0,tx,0,8,0102030405060708', '0.020500,1,18DA10F1,1,rx,0,2,ABCD', '0.030000,1,100,0,rx,1,3,', '0.040000,1,7FF,0,tx,0,0,', ''].join('\r\n'),
    );
  });

  it('says which formats can carry a note about lost frames', () => {
    expect(FORMATS.map((x) => [x.id, x.carriesDrops])).toEqual([['asc', true], ['candump', false], ['csv', false]]);
    expect(formatSpec('asc').extension).toBe('asc');
  });
});

describe('Recorder', () => {
  it('counts frames, bytes, duration and the drops the device reported, even in formats that cannot write them', () => {
    const r = new Recorder('candump', START);
    fixture(r);
    expect([r.frames, r.dropped, r.bytes]).toEqual([5, 3, r.text().length]);
    expect(r.durationS).toBeCloseTo(0.040000001, 9);
    expect(r.text()).not.toMatch(/lost/);
  });

  it('stops at the size cap, keeps what it has, and says so', () => {
    const r = new Recorder('csv', START, 200);
    for (let i = 0; i < 100; i += 1) r.frame(f({ timestampNs: 5_000_000_000n + BigInt(i) * 1_000_000n }));
    expect(r.capped).toBe(true);
    expect(r.running).toBe(false);
    expect(r.bytes).toBeLessThanOrEqual(200);
    expect(r.frames).toBeGreaterThan(0);
    expect(r.frames).toBeLessThan(100);
    const before = r.frames;
    r.frame(f());
    expect(r.frames).toBe(before); // nothing more is written after the cap
  });

  it('writes nothing after stop', async () => {
    const r = new Recorder('asc', START);
    r.frame(f());
    const blob = r.stop();
    r.frame(f());
    expect(r.frames).toBe(1);
    expect(await blob.text()).toBe(r.text());
    expect(blob.type).toContain('text/plain');
  });

  it('keeps time exact above 2^53 ns and handles frames that arrive slightly out of order', () => {
    const r = new Recorder('candump', START);
    r.frame(f({ timestampNs: 2n ** 63n + 12345n }));
    r.frame(f({ timestampNs: 2n ** 63n + 12345n + 1_000n }));
    r.frame(f({ timestampNs: 2n ** 63n + 12345n - 2_000n }));
    expect(r.text().split('\n').slice(0, 3)).toEqual(['(0.000000) can0 123#11223344', '(0.000001) can0 123#11223344', '(-0.000002) can0 123#11223344']);
  });
});

describe('RecordingService', () => {
  const fakeStore = () => ({ taps: new Set<unknown>() }) as unknown as WorkspaceStore & { taps: Set<unknown> };

  it('taps the store while recording, and lets go when it stops', () => {
    const service = new RecordingService();
    const store = fakeStore();
    let changes = 0;
    service.subscribe(() => changes++);
    service.start(store, 'asc', START);
    expect(store.taps.size).toBe(1);
    service.current!.frame(f());
    const done = service.stop(new Date(2026, 10, 1, 9, 8, 7))!;
    expect(store.taps.size).toBe(0);
    expect(service.current).toBeNull();
    expect(done.summary).toMatchObject({ fileName: 'bridge-20261101-090807.asc', frames: 1, dropped: 0, carriesDrops: true });
    expect(service.last).toEqual(done.summary);
    expect(changes).toBe(2);
    expect(service.stop()).toBeNull();
  });

  it('a new recording replaces a running one without leaving a tap behind', () => {
    const service = new RecordingService();
    const a = fakeStore();
    const b = fakeStore();
    service.start(a, 'asc', START);
    service.start(b, 'csv', START);
    expect(a.taps.size).toBe(0);
    expect(b.taps.size).toBe(1);
    expect(service.current?.spec.id).toBe('csv');
  });

  it('names files from the local time', () => {
    expect(recordingFileName(new Date(2026, 0, 2, 3, 4, 5), 'log')).toBe('bridge-20260102-030405.log');
  });
});
