import { describe, expect, it } from 'vitest';
import { decodeBatch, decodeDescriptor, decodeFrame } from '../src/protocol/decode';
import { ProtocolViolation } from '../src/protocol/errors';
import { isCompatibleVersion } from '../src/protocol/types';

const frame = (over: Record<string, unknown> = {}) => ({ channel: 1, id: 0x123, extended: false, rtr: false, dlc: 2, data: 'abcd', timestamp_ns: 5n, direction: 'rx', ...over });

describe('frame decoding keeps channel, timestamp and direction exactly', () => {
  it('decodes a data frame', () => {
    expect(decodeFrame(frame())).toEqual({ channel: 1, id: 0x123, extended: false, rtr: false, dlc: 2, data: Uint8Array.of(0xab, 0xcd), timestampNs: 5n, direction: 'rx' });
  });
  it('keeps a transmitted echo as direction tx on its own channel', () => {
    expect(decodeFrame(frame({ channel: 2, direction: 'tx' }))).toMatchObject({ channel: 2, direction: 'tx' });
  });
  it('decodes extended ids and RTR (dlc without data)', () => {
    expect(decodeFrame(frame({ id: 0x1fffffff, extended: true }))).toMatchObject({ id: 0x1fffffff, extended: true });
    expect(decodeFrame(frame({ rtr: true, dlc: 5, data: '' }))).toMatchObject({ rtr: true, dlc: 5, data: new Uint8Array() });
  });
  it.each([
    ['standard id out of range', { id: 0x800 }],
    ['extended id out of range', { id: 0x20000000, extended: true }],
    ['dlc above 8', { dlc: 9, data: '00'.repeat(9) }],
    ['data shorter than dlc', { dlc: 3 }],
    ['data on an RTR frame', { rtr: true }],
    ['uppercase hex', { data: 'ABCD' }],
    ['non-hex data', { data: 'zz' }],
    ['unknown direction', { direction: 'both' }],
    ['timestamp not 64-bit', { timestamp_ns: 5 }],
    ['negative channel', { channel: -1 }],
  ])('rejects %s', (_name, over) => {
    expect(() => decodeFrame(frame(over))).toThrow(ProtocolViolation);
  });
});

describe('batches and descriptors', () => {
  it('decodes a batch with its drop count', () => {
    const batch = decodeBatch({ seq: 7, channel: 2, dropped: 936, frames: [frame({ channel: 2 })] });
    expect(batch).toMatchObject({ seq: 7, channel: 2, dropped: 936 });
    expect(batch.frames).toHaveLength(1);
  });
  const descriptor = (over: Record<string, unknown> = {}) => ({
    contract_version: '0.1.0', session_id: 's', device_id: 'd', firmware: 'f', profile: 'prototype2', can_fd: false,
    supported_bitrates: [500000, 1000000], rx_queue_capacity: 256,
    clock: { monotonic_ns: 1n, wall_clock_ns: null, wall_clock_synced: false },
    channels: [{ channel: 1, name: 'CAN1', bitrate: null, termination: false, bus_state: 'error_active', streaming: false, rx_queue_depth: 0, rx_queue_capacity: 256 }],
    ...over,
  });
  it('accepts a valid descriptor: unconfigured bitrate, termination off', () => {
    const d = decodeDescriptor(descriptor());
    expect(d.channels[0]).toMatchObject({ bitrate: null, termination: false });
  });
  it('refuses a device that advertises CAN FD', () => {
    expect(() => decodeDescriptor(descriptor({ can_fd: true }))).toThrow(ProtocolViolation);
  });
  it('refuses zero or three channels', () => {
    expect(() => decodeDescriptor(descriptor({ channels: [] }))).toThrow(ProtocolViolation);
  });
});

describe('contract version compatibility (SPEC section 1)', () => {
  it.each([
    ['0.1.0', '0.1.0', true],
    ['0.1.9', '0.1.0', true],
    ['0.2.0', '0.1.0', false],
    ['1.0.0', '0.1.0', false],
    ['x.y.z', '0.1.0', false],
  ])('%s vs %s -> %s', (device, client, expected) => {
    expect(isCompatibleVersion(device, client)).toBe(expected);
  });
});
