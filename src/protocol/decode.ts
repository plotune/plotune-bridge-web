// Strict decoding of device messages. Anything outside the contract is a ProtocolViolation.
import { ProtocolViolation } from './errors';
import type { WireObject } from './wire';
import type {
  BusState,
  CanFrame,
  ChannelStatistics,
  ChannelStatus,
  ClockInfo,
  DeviceDescriptor,
  Direction,
  FrameBatch,
  StatisticsResult,
} from './types';
import { MAX_DLC, MAX_EXTENDED_ID, MAX_STANDARD_ID } from './types';

const BUS_STATES: BusState[] = ['error_active', 'error_warning', 'error_passive', 'bus_off'];

function obj(value: unknown, what: string): WireObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProtocolViolation(`${what} must be an object`);
  return value as WireObject;
}
function arr(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new ProtocolViolation(`${what} must be an array`);
  return value;
}
function uint(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ProtocolViolation(`${what} must be a non-negative integer`);
  return value;
}
function big(value: unknown, what: string): bigint {
  if (typeof value !== 'bigint') throw new ProtocolViolation(`${what} must be an unsigned 64-bit integer`);
  return value;
}
function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new ProtocolViolation(`${what} must be a boolean`);
  return value;
}
function str(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new ProtocolViolation(`${what} must be a string`);
  return value;
}

export function hexToBytesStrict(text: string, what: string): Uint8Array {
  if (!/^([0-9a-f]{2})*$/.test(text)) throw new ProtocolViolation(`${what} must be lowercase hex pairs`);
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(text.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function decodeFrame(wire: unknown): CanFrame {
  const w = obj(wire, 'frame');
  const extended = bool(w.extended, 'frame.extended');
  const rtr = bool(w.rtr, 'frame.rtr');
  const id = uint(w.id, 'frame.id');
  if (id > (extended ? MAX_EXTENDED_ID : MAX_STANDARD_ID)) throw new ProtocolViolation('frame.id is out of range for its format');
  const dlc = uint(w.dlc, 'frame.dlc');
  if (dlc > MAX_DLC) throw new ProtocolViolation('frame.dlc exceeds 8');
  const data = hexToBytesStrict(str(w.data, 'frame.data'), 'frame.data');
  if (rtr ? data.length !== 0 : data.length !== dlc) throw new ProtocolViolation('frame.data length does not match dlc');
  const direction = str(w.direction, 'frame.direction');
  if (direction !== 'rx' && direction !== 'tx') throw new ProtocolViolation('frame.direction must be rx or tx');
  return {
    channel: uint(w.channel, 'frame.channel'),
    id,
    extended,
    rtr,
    dlc,
    data,
    timestampNs: big(w.timestamp_ns, 'frame.timestamp_ns'),
    direction: direction as Direction,
  };
}

export function decodeChannelStatus(wire: unknown): ChannelStatus {
  const w = obj(wire, 'channel status');
  const bitrate = w.bitrate === null ? null : uint(w.bitrate, 'bitrate');
  const busState = str(w.bus_state, 'bus_state') as BusState;
  if (!BUS_STATES.includes(busState)) throw new ProtocolViolation('bus_state is not a known value');
  return {
    channel: uint(w.channel, 'channel'),
    name: str(w.name, 'name'),
    bitrate,
    termination: bool(w.termination, 'termination'),
    busState,
    streaming: bool(w.streaming, 'streaming'),
    rxQueueDepth: uint(w.rx_queue_depth, 'rx_queue_depth'),
    rxQueueCapacity: uint(w.rx_queue_capacity, 'rx_queue_capacity'),
  };
}

export function decodeStatistics(wire: unknown): ChannelStatistics {
  const w = obj(wire, 'statistics');
  return {
    channel: uint(w.channel, 'channel'),
    rxReceived: uint(w.rx_received, 'rx_received'),
    rxForwarded: uint(w.rx_forwarded, 'rx_forwarded'),
    rxDropped: uint(w.rx_dropped, 'rx_dropped'),
    rxOverflow: uint(w.rx_overflow, 'rx_overflow'),
    txSent: uint(w.tx_sent, 'tx_sent'),
    txFailed: uint(w.tx_failed, 'tx_failed'),
    txEchoDropped: uint(w.tx_echo_dropped, 'tx_echo_dropped'),
    busErrors: uint(w.bus_errors, 'bus_errors'),
  };
}

export function decodeStatisticsResult(wire: unknown): StatisticsResult {
  const w = obj(wire, 'get_statistics result');
  return {
    timestampNs: big(w.timestamp_ns, 'timestamp_ns'),
    sinceNs: big(w.since_ns, 'since_ns'),
    statistics: arr(w.statistics, 'statistics').map(decodeStatistics),
  };
}

function decodeClock(wire: unknown): ClockInfo {
  const w = obj(wire, 'clock');
  const wall = w.wall_clock_ns === null ? null : big(w.wall_clock_ns, 'wall_clock_ns');
  return { monotonicNs: big(w.monotonic_ns, 'monotonic_ns'), wallClockNs: wall, wallClockSynced: bool(w.wall_clock_synced, 'wall_clock_synced') };
}

export function decodeDescriptor(wire: unknown): DeviceDescriptor {
  const w = obj(wire, 'hello result');
  if (w.can_fd !== false) throw new ProtocolViolation('can_fd must be false: this workspace supports classic CAN only');
  const supported = arr(w.supported_bitrates, 'supported_bitrates').map((v) => uint(v, 'supported_bitrates item'));
  const channels = arr(w.channels, 'channels').map(decodeChannelStatus);
  if (channels.length < 1 || channels.length > 2) throw new ProtocolViolation('a device exposes one or two channels');
  return {
    contractVersion: str(w.contract_version, 'contract_version'),
    sessionId: str(w.session_id, 'session_id'),
    deviceId: str(w.device_id, 'device_id'),
    firmware: str(w.firmware, 'firmware'),
    profile: str(w.profile, 'profile'),
    canFd: false,
    supportedBitrates: supported,
    rxQueueCapacity: uint(w.rx_queue_capacity, 'rx_queue_capacity'),
    clock: decodeClock(w.clock),
    channels,
  };
}

export function decodeBatch(wire: unknown): FrameBatch {
  const w = obj(wire, 'frames event');
  return {
    seq: uint(w.seq, 'seq'),
    channel: uint(w.channel, 'channel'),
    dropped: uint(w.dropped, 'dropped'),
    frames: arr(w.frames, 'frames').map(decodeFrame),
  };
}

export function decodeChannels(wire: unknown): ChannelStatus[] {
  return arr(obj(wire, 'result').channels, 'channels').map(decodeChannelStatus);
}

export function decodeChannel(wire: unknown): ChannelStatus {
  return decodeChannelStatus(obj(wire, 'result').channel);
}
