import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ISOTP, IsoTpError, IsoTpLink, type IsoTpConfig } from '../src/diagnostics/isotp';
import type { CanFrame } from '../src/protocol/types';
import { EcuLoopback } from './helpers/fakes';
import { MockEcu, type EcuOptions } from './helpers/mockEcu';
import { settle } from './helpers/timers';

const cfg = (over: Partial<IsoTpConfig> = {}): IsoTpConfig => ({ channel: 1, ...DEFAULT_ISOTP, ...over });
const rig = (ecuOptions: EcuOptions = {}, config: Partial<IsoTpConfig> = {}) => {
  const ecu = new MockEcu(ecuOptions);
  const io = new EcuLoopback(ecu, config.channel ?? 1);
  const link = new IsoTpLink(io, cfg(config));
  link.start();
  return { ecu, io, link };
};
const bytes = (...v: number[]) => Uint8Array.from(v);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ISO-TP single and multi frame', () => {
  it('sends a single frame and receives a single-frame answer', async () => {
    const { link, io } = rig();
    const reply = await settle(link.transact(bytes(0x10, 0x03)));
    expect(Array.from(reply)).toEqual([0x50, 0x03, 0x00, 0x32, 0x01, 0xf4]);
    expect(io.transmitted[0]).toMatchObject({ channel: 1, id: 0x700, extended: false, dlc: 8 });
    expect(Array.from(io.transmitted[0].data)).toEqual([0x02, 0x10, 0x03, 0, 0, 0, 0, 0]); // padded with the configured byte
  });

  it('reassembles a multi-frame answer and sends flow control (43-byte answer)', async () => {
    const { link, io } = rig();
    const reply = await settle(link.transact(bytes(0x22, 0xf1, 0x90, 0xf1, 0x91, 0xf1, 0x92, 0xf1, 0x93)));
    expect(reply).toHaveLength(43);
    expect(String.fromCharCode(...reply.slice(3, 20))).toBe('PLOTUNE-SYNTH-001');
    const flow = io.transmitted.filter((f) => f.data[0] >> 4 === 3);
    expect(flow).toHaveLength(1);
    expect(Array.from(flow[0].data.slice(0, 3))).toEqual([0x30, 0, 0]);
  });

  it('sends a multi-frame request in order after flow control, and the ECU reassembles it', async () => {
    const { link, ecu } = rig();
    const request = Uint8Array.from({ length: 40 }, (_, i) => (i === 0 ? 0x22 : 0xf1 + (i % 2)));
    await settle(link.send(request));
    expect(Array.from(ecu.received[0])).toEqual(Array.from(request));
  });

  it('honours the ECU block size and STmin when sending', async () => {
    const { link, io, ecu } = rig({ flowBlockSize: 2, flowStMin: 20 });
    const request = Uint8Array.from({ length: 6 + 7 * 5 }, (_, i) => (i === 0 ? 0x2e : i)); // FF + 5 CF
    const times: number[] = [];
    const real = io.transmit.bind(io);
    io.transmit = async (f) => {
      times.push(Date.now());
      return real(f);
    };
    await settle(link.send(request));
    expect(Array.from(ecu.received[0])).toEqual(Array.from(request));
    const cfTimes = times.slice(1); // after the first frame
    expect(cfTimes).toHaveLength(5);
    expect(cfTimes[1] - cfTimes[0]).toBeGreaterThanOrEqual(20); // STmin between consecutive frames
    expect(cfTimes[2] - cfTimes[1]).toBeGreaterThanOrEqual(1); // a new block waits for flow control first
  });

  it('maximum payload is 4095 bytes; 0 and 4096 are refused', async () => {
    const { link } = rig();
    await expect(link.send(new Uint8Array())).rejects.toMatchObject({ code: 'invalid-length' });
    await expect(link.send(new Uint8Array(4096))).rejects.toMatchObject({ code: 'invalid-length' });
  });

  it('can send unpadded frames', async () => {
    const { link, io } = rig({}, { padding: null });
    await settle(link.transact(bytes(0x3e, 0x00)));
    expect(io.transmitted[0].dlc).toBe(3);
  });
});

describe('ISO-TP failure paths', () => {
  it('reports a missing answer as a timeout', async () => {
    const { link } = rig({}, { rxId: 0x7ff });
    await expect(settle(link.transact(bytes(0x3e, 0x00), 300))).rejects.toMatchObject({ code: 'timeout' });
  });

  it('reports missing flow control', async () => {
    const { link } = rig({ silent: true });
    await expect(settle(link.send(new Uint8Array(20).fill(1)))).rejects.toMatchObject({ code: 'flow-control-timeout' });
  });

  it('reports a flow-control overflow from the other end', async () => {
    const { link } = rig({ flowStatus: 2 });
    await expect(settle(link.send(new Uint8Array(20).fill(1)))).rejects.toMatchObject({ code: 'overflow' });
  });

  it('gives up after too many WAIT frames', async () => {
    const ecu = new MockEcu({ silent: true });
    const io = new EcuLoopback(ecu);
    const link = new IsoTpLink(io, cfg());
    link.start();
    const original = io.transmit.bind(io);
    io.transmit = async (f) => {
      await original(f);
      if (f.data[0] >> 4 === 1) for (let i = 1; i <= 12; i += 1) setTimeout(() => io.emit({ channel: 1, id: 0x708, extended: false, rtr: false, dlc: 3, data: bytes(0x31, 0, 0), direction: 'rx' }), i * 5);
    };
    await expect(settle(link.send(new Uint8Array(20).fill(1)))).rejects.toMatchObject({ code: 'too-many-waits' });
  });

  it('drops a message whose consecutive frame arrives out of order', async () => {
    const { link, io } = rig();
    const pending = link.receive(500);
    const handled = expect(settle(pending)).rejects.toMatchObject({ code: 'sequence' });
    io.emit({ channel: 1, id: 0x708, extended: false, rtr: false, dlc: 8, data: bytes(0x10, 0x14, 1, 2, 3, 4, 5, 6), direction: 'rx' });
    io.emit({ channel: 1, id: 0x708, extended: false, rtr: false, dlc: 8, data: bytes(0x23, 7, 8, 9, 10, 11, 12, 13), direction: 'rx' }); // SN 3, expected 1
    await handled;
  });

  it('turns a failing transmit into a send error', async () => {
    const { link, io } = rig();
    io.transmit = async () => {
      throw new Error('link down');
    };
    await expect(link.send(bytes(0x3e, 0))).rejects.toMatchObject({ code: 'send-failed' });
  });

  it('stop() rejects anything still waiting', async () => {
    const { link } = rig({}, { rxId: 0x7ff });
    const waiting = link.receive(5000);
    const handled = expect(waiting).rejects.toBeInstanceOf(IsoTpError);
    link.stop();
    await handled;
  });
});

describe('ISO-TP only accepts its own frames', () => {
  const frame = (over: Partial<CanFrame>): CanFrame => ({ channel: 1, id: 0x708, extended: false, rtr: false, dlc: 3, data: bytes(0x02, 0x7e, 0x00), timestampNs: 1n, direction: 'rx', ...over });
  it.each([
    ['another id', { id: 0x709 }],
    ['another channel', { channel: 2 }],
    ['an extended id with the same number', { extended: true }],
    ['our own transmission echoed back', { direction: 'tx' as const }],
    ['a remote request', { rtr: true }],
  ])('ignores %s', async (_n, over) => {
    const { link, io } = rig({}, { rxId: 0x708 });
    const waiting = link.receive(100);
    io.listeners.forEach((l) => l(frame(over)));
    await expect(settle(waiting)).rejects.toMatchObject({ code: 'timeout' });
  });
  it('accepts a matching frame', async () => {
    const { link, io } = rig();
    const waiting = link.receive(100);
    io.listeners.forEach((l) => l(frame({})));
    expect(Array.from(await settle(waiting))).toEqual([0x7e, 0x00]);
  });
  it('a stale unsolicited message is not mistaken for the next answer', async () => {
    const { link, io } = rig();
    io.listeners.forEach((l) => l(frame({ data: bytes(0x02, 0x7e, 0x00) })));
    const reply = await settle(link.transact(bytes(0x10, 0x01)));
    expect(reply[0]).toBe(0x50);
  });
});
