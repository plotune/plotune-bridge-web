// Domain types for the Bridge CAN device contract v0.1.0 (Classic CAN only).
// Wire names are snake_case; these are the camelCase forms. Nothing is renamed semantically:
// channel numbers, device timestamps, direction and drop counters are carried through unchanged.

export const CONTRACT_VERSION = '0.1.0';
export const MAX_DLC = 8;
export const MAX_STANDARD_ID = 0x7ff;
export const MAX_EXTENDED_ID = 0x1fff_ffff;
/** SPEC section 1: adapters accept requests of at least this many UTF-8 bytes; clients must not send more. */
export const MAX_REQUEST_BYTES = 4096;
export const UINT64_MAX = (1n << 64n) - 1n;

export type Direction = 'rx' | 'tx';
export type BusState = 'error_active' | 'error_warning' | 'error_passive' | 'bus_off';

export const DEVICE_ERROR_CODES = [
  'INVALID_ID',
  'INVALID_DLC',
  'INVALID_DATA',
  'UNKNOWN_CHANNEL',
  'UNSUPPORTED_BITRATE',
  'UNSUPPORTED_FEATURE',
  'MALFORMED_REQUEST',
  'UNKNOWN_OPERATION',
  'UNSUPPORTED_VERSION',
  'CHANNEL_NOT_CONFIGURED',
  'CHANNEL_BUSY',
  'BUS_OFF',
  'TX_QUEUE_FULL',
  'NOT_CONNECTED',
  'INTERNAL_ERROR',
] as const;
/** Codes a device can send in an error response. */
export type DeviceErrorCode = (typeof DEVICE_ERROR_CODES)[number];
/** Codes raised by the client side of a transport (SPEC section 7); a dead link cannot send them. */
export type ClientErrorCode = 'DEVICE_DISCONNECTED' | 'TIMEOUT' | 'NOT_CONNECTED';
export type ErrorCode = DeviceErrorCode | ClientErrorCode;

export interface TxFrame {
  channel: number;
  id: number;
  extended: boolean;
  rtr: boolean;
  dlc: number;
  data: Uint8Array;
}

export interface CanFrame extends TxFrame {
  /** Device-side monotonic capture time in nanoseconds (uint64). Never converted to a double. */
  timestampNs: bigint;
  direction: Direction;
}

export interface ChannelStatus {
  channel: number;
  name: string;
  bitrate: number | null;
  termination: boolean;
  busState: BusState;
  streaming: boolean;
  rxQueueDepth: number;
  rxQueueCapacity: number;
}

export interface ChannelStatistics {
  channel: number;
  rxReceived: number;
  rxForwarded: number;
  rxDropped: number;
  rxOverflow: number;
  txSent: number;
  txFailed: number;
  txEchoDropped: number;
  busErrors: number;
}

export interface ClockInfo {
  monotonicNs: bigint;
  wallClockNs: bigint | null;
  wallClockSynced: boolean;
}

export interface DeviceDescriptor {
  contractVersion: string;
  sessionId: string;
  deviceId: string;
  firmware: string;
  profile: string;
  canFd: false;
  supportedBitrates: number[];
  rxQueueCapacity: number;
  clock: ClockInfo;
  channels: ChannelStatus[];
}

export interface FrameBatch {
  seq: number;
  channel: number;
  /** Frames lost on this channel since its previous batch; the exact position is not known. */
  dropped: number;
  frames: CanFrame[];
}

export interface StatisticsResult {
  timestampNs: bigint;
  sinceNs: bigint;
  statistics: ChannelStatistics[];
}

/** 0.x versions are compatible only on identical MAJOR.MINOR; from 1.0 on, on identical MAJOR (SPEC section 1). */
export function isCompatibleVersion(device: string, client: string = CONTRACT_VERSION): boolean {
  const parse = (v: string) => v.split('.').map(Number);
  const [d, c] = [parse(device), parse(client)];
  if (d.length !== 3 || d.some(Number.isNaN)) return false;
  return d[0] === 0 ? d[0] === c[0] && d[1] === c[1] : d[0] === c[0];
}
