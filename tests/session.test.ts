import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceSession } from '../src/device/session';
import { ContractError } from '../src/protocol/errors';
import type { CanFrame, FrameBatch } from '../src/protocol/types';
import { TransportOpenError } from '../src/transport/types';
import { FakeTransport } from './helpers/fakes';
import { MockDeviceCore } from './helpers/mockDevice';

const setup = (deviceOptions = {}) => {
  const device = new MockDeviceCore(deviceOptions);
  const transport = new FakeTransport('ws://fake', device);
  const batches: FrameBatch[] = [];
  const lost: number[] = [];
  const closes: unknown[] = [];
  const session = new DeviceSession(transport, { frames: (b) => batches.push(b), batchesLost: (n) => lost.push(n), closed: (i) => closes.push(i) });
  return { device, transport, session, batches, lost, closes };
};
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof ContractError ? e.code : String(e)));

afterEach(() => vi.useRealTimers());

describe('DeviceSession', () => {
  it('connects, says hello with the contract version and decodes the descriptor', async () => {
    const { session, transport } = setup();
    const d = await session.connect();
    expect(transport.sent[0]).toMatchObject({ op: 'hello', params: { contract_version: '0.1.0' } });
    expect(d).toMatchObject({ contractVersion: '0.1.0', canFd: false, profile: 'prototype2' });
    expect(d.channels.map((c) => [c.name, c.bitrate, c.termination])).toEqual([['CAN1', null, false], ['CAN2', null, false]]);
    expect(d.clock.monotonicNs).toBeGreaterThan(2n ** 60n);
    expect(d.clock.wallClockNs! - d.clock.monotonicNs).toBe(1_700_000_000_000_000_001n);
  });

  it('maps device errors to contract error codes', async () => {
    const { session } = setup();
    await session.connect();
    expect(await code(session.setBitrate(1, 33333))).toBe('UNSUPPORTED_BITRATE');
    expect(await code(session.setBitrate(3, 500000))).toBe('UNKNOWN_CHANNEL');
    expect(await code(session.startRx())).toBe('CHANNEL_NOT_CONFIGURED');
    await session.setBitrate(1, 500000);
    await session.startRx([1]);
    expect(await code(session.setBitrate(1, 250000))).toBe('CHANNEL_BUSY');
    expect(await code(session.transmit({ channel: 1, id: 0x800, extended: false, rtr: false, dlc: 0, data: new Uint8Array() }))).toBe('INVALID_ID');
  });

  it('keeps the unconfigured state visible: bit rate null until set, termination off until switched', async () => {
    const { session } = setup();
    await session.connect();
    expect((await session.setTermination(2, true)).termination).toBe(true);
    const [one, two] = await session.channelStatus();
    expect([one.termination, two.termination, one.bitrate]).toEqual([false, true, null]);
  });

  it('delivers frames with channel, direction and 64-bit timestamps unchanged', async () => {
    const { session, device, batches } = setup();
    await session.connect();
    await session.setBitrate(1, 500000);
    await session.setBitrate(2, 500000);
    await session.startRx();
    device.injectRx(2, { id: 0x321, data: Uint8Array.of(1, 2, 3), timestampNs: 2n ** 62n + 7n });
    device.deliver();
    await Promise.resolve();
    const frame: CanFrame = batches[0].frames[0];
    expect(frame).toMatchObject({ channel: 2, id: 0x321, direction: 'rx', timestampNs: 2n ** 62n + 7n });
    expect(batches[0].channel).toBe(2);
  });

  it('counts a gap in the batch sequence as lost batches', async () => {
    const { session, device, lost } = setup();
    await session.connect();
    await session.setBitrate(1, 500000);
    await session.startRx([1]);
    device.injectRx(1, { id: 1 });
    device.deliver();
    device.skipSequence(3);
    device.injectRx(1, { id: 2 });
    device.deliver();
    await Promise.resolve();
    expect(lost).toEqual([3]);
  });

  it('a timeout is TIMEOUT, not a hang', async () => {
    vi.useFakeTimers();
    const device = new MockDeviceCore();
    const transport = new FakeTransport('ws://fake', device);
    const session = new DeviceSession(transport, {}, { requestTimeoutMs: 500, helloTimeoutMs: 500 });
    transport.send = () => undefined; // the device never answers
    const result = code(session.connect());
    await vi.advanceTimersByTimeAsync(600);
    expect(await result).toBe('TIMEOUT');
  });

  it('a link that ends fails the pending request with DEVICE_DISCONNECTED and reports the close', async () => {
    const { session, transport, closes } = setup();
    await session.connect();
    transport.autoDeliver = false;
    const pending = code(session.channelStatus());
    transport.dropWith(1013, 'send queue overflow');
    expect(await pending).toBe('DEVICE_DISCONNECTED');
    expect(closes).toEqual([{ phase: 'open', code: 1013, reason: 'send queue overflow', wasClean: true, initiatedBy: 'remote' }]);
    expect(await code(session.channelStatus())).toBe('DEVICE_DISCONNECTED');
  });

  it('refuses a device on an incompatible contract version and closes the link', async () => {
    const device = new MockDeviceCore();
    const transport = new FakeTransport('ws://fake', device);
    const session = new DeviceSession(transport, {});
    const answer = device.handle.bind(device);
    device.handle = (m) => {
      const reply = answer(m) as { result?: Record<string, unknown> };
      if (reply.result?.contract_version) reply.result.contract_version = '0.2.0'; // the device claims a newer, incompatible version
      return reply as never;
    };
    expect(await code(session.connect())).toBe('UNSUPPORTED_VERSION');
    expect(transport.isOpen).toBe(false);
  });

  it('refuses a device that advertises CAN FD and closes the link', async () => {
    const { session, transport } = setup({ advertiseCanFd: true });
    expect(await code(session.connect())).toBe('INTERNAL_ERROR');
    expect(transport.isOpen).toBe(false);
  });

  it('closes the link on a malformed batch instead of guessing', async () => {
    const { session, transport, closes } = setup();
    await session.connect();
    transport.listener!.message({ type: 'event', event: 'frames', data: { seq: 0, channel: 1, dropped: 0, frames: [{ nonsense: true }] } });
    await Promise.resolve();
    expect(transport.isOpen).toBe(false);
    expect(closes[0]).toMatchObject({ code: 4000 });
  });

  it('ignores unknown events and late answers', async () => {
    const { session, transport } = setup();
    await session.connect();
    transport.listener!.message({ type: 'event', event: 'from_the_future', data: {} });
    transport.listener!.message({ type: 'response', id: 999, ok: true, result: {} });
    expect(transport.isOpen).toBe(true);
  });

  it('an open failure propagates as TransportOpenError so the caller can explain it', async () => {
    const { session, transport } = setup();
    transport.failOpen = { phase: 'connecting', code: 1006, reason: '', wasClean: false, initiatedBy: 'remote' };
    await expect(session.connect()).rejects.toBeInstanceOf(TransportOpenError);
  });
});
