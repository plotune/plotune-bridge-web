import { describe, expect, it } from 'vitest';
import { BLF_OBJECT_SIZE, blfCanMessage, buildBlfBytes } from '../src/record/blf';
import { Recorder } from '../src/record/recorder';
import type { CanFrame } from '../src/protocol/types';

const f = (over: Partial<CanFrame> = {}): CanFrame => ({ channel: 1, id: 0x123, extended: false, rtr: false, dlc: 4, data: Uint8Array.of(0x11, 0x22, 0x33, 0x44), timestampNs: 5_000_000_000n, direction: 'rx', ...over });
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads the first container of a BLF file back into its uncompressed objects. */
async function firstContainer(bytes: Uint8Array): Promise<{ header: DataView; objects: Uint8Array }> {
  const header = new DataView(bytes.buffer.slice(0, 144));
  const c = new DataView(bytes.buffer, 144);
  const objSize = c.getUint32(8, true);
  const uncompressed = c.getUint32(24, true);
  const objects = await inflate(bytes.subarray(144 + 32, 144 + objSize));
  expect(objects.length).toBe(uncompressed);
  return { header, objects };
}

describe('BLF writer (also read with python-can 4.6.1 and compared with its own writer, see docs/recording.md)', () => {
  it('writes a 48-byte CAN message object: signature, sizes, nanosecond time, channel, flags, dlc, id, data', () => {
    const o = blfCanMessage(f({ channel: 2, id: 0x18da10f1, extended: true, dlc: 3, data: Uint8Array.of(0xab, 0xcd, 0xef), direction: 'tx' }), 12_345_678n);
    expect(o.length).toBe(BLF_OBJECT_SIZE);
    expect(hex(o)).toBe(
      ['4c4f424a', '2000', '0100', '30000000', '01000000', '02000000', '0000', '0000', '4e61bc0000000000', '0200', '01', '03', 'f110da98', 'abcdef0000000000'].join(''),
    );
  });

  it('marks remote frames and receive vs transmit, and masks standard ids', () => {
    const rtr = blfCanMessage(f({ rtr: true, dlc: 2, data: new Uint8Array(0) }), 0n);
    expect([rtr[34], rtr[35], hex(rtr.subarray(40))]).toEqual([0x80, 2, '0000000000000000']);
    const tx = blfCanMessage(f({ direction: 'tx' }), 0n);
    expect(tx[34]).toBe(0x01);
    expect(hex(tx.subarray(36, 40))).toBe('23010000');
  });

  it('writes the file header and a zlib container whose content is exactly the objects', async () => {
    const objects = [blfCanMessage(f(), 0n), blfCanMessage(f({ id: 0x7e8 }), 10_000_000n)];
    const file = await buildBlfBytes(objects, new Date(Date.UTC(2026, 10, 1, 12, 5, 9, 7)), new Date(Date.UTC(2026, 10, 1, 12, 5, 10, 0)));
    const { header, objects: raw } = await firstContainer(file);
    expect(String.fromCharCode(header.getUint8(0), header.getUint8(1), header.getUint8(2), header.getUint8(3))).toBe('LOGG');
    expect(header.getUint32(4, true)).toBe(144);
    expect(Number(header.getBigUint64(16, true))).toBe(file.length);
    expect(header.getUint32(32, true)).toBe(2); // object count
    expect([2026, 11, 0, 1, 12, 5, 9, 7].map((_, i) => header.getUint16(40 + i * 2, true))).toEqual([2026, 11, 0, 1, 12, 5, 9, 7]); // start, UTC, Sunday
    expect(hex(raw)).toBe(objects.map(hex).join(''));
  });

  it('splits into several containers past 128 KiB, never in the middle of an object', async () => {
    const objects = Array.from({ length: 4000 }, (_, i) => blfCanMessage(f({ id: i & 0x7ff }), BigInt(i)));
    const file = await buildBlfBytes(objects, new Date(0), new Date(0));
    const bytes = file;
    let at = 144;
    let total = 0;
    let containers = 0;
    while (at < bytes.length) {
      const v = new DataView(bytes.buffer, at);
      const objSize = v.getUint32(8, true);
      const raw = await inflate(bytes.subarray(at + 32, at + objSize));
      expect(raw.length % BLF_OBJECT_SIZE).toBe(0);
      expect(raw.length).toBeLessThanOrEqual(128 * 1024);
      total += raw.length / BLF_OBJECT_SIZE;
      containers += 1;
      at += objSize + (objSize % 4);
    }
    expect([containers > 1, total, at]).toEqual([true, 4000, bytes.length]);
  });

  it('an empty recording is just the header', async () => {
    const file = await buildBlfBytes([], new Date(0), new Date(0));
    expect(file.length).toBe(144);
  });

  it('records through the Recorder, counting frames and bytes against the cap, with times relative to the first frame', async () => {
    const r = new Recorder('blf', new Date(Date.UTC(2026, 10, 1)));
    r.frame(f({ timestampNs: 2n ** 63n + 5n }));
    r.frame(f({ timestampNs: 2n ** 63n + 2_000_005n, id: 0x7e8 }));
    expect([r.frames, r.bytes, r.dropped]).toEqual([2, 2 * BLF_OBJECT_SIZE, 0]);
    const { objects } = await firstContainer(await r.blfBytes());
    const v = new DataView(objects.buffer, objects.byteOffset);
    expect([Number(v.getBigUint64(24, true)), Number(v.getBigUint64(BLF_OBJECT_SIZE + 24, true))]).toEqual([0, 2_000_000]);
    const small = new Recorder('blf', new Date(0), 100);
    small.frame(f());
    small.frame(f());
    small.frame(f());
    expect([small.frames, small.capped]).toEqual([2, true]);
  });
});
