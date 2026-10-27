import type { ErrorCode } from './types';

/** A contract-level error: a device error response, or a client-side transport condition (SPEC section 6, 7). */
export class ContractError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message = '', details: Record<string, unknown> = {}) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'ContractError';
    this.code = code;
    this.details = details;
  }
}

/** The device sent something the contract does not allow. The link is closed rather than guessing. */
export class ProtocolViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolViolation';
  }
}

const PLAIN: Record<ErrorCode, string> = {
  INVALID_ID: 'The CAN ID is not valid. Standard IDs go up to 7FF and extended IDs up to 1FFFFFFF (hex).',
  INVALID_DLC: 'The data length does not match. A CAN frame carries 0 to 8 bytes.',
  INVALID_DATA: 'The data is not valid. Use pairs of hex digits, and no data for a remote request.',
  UNKNOWN_CHANNEL: 'This device does not have that channel.',
  UNSUPPORTED_BITRATE: 'The device does not support that bit rate.',
  UNSUPPORTED_FEATURE: 'The device only supports classic CAN, so that option is not available.',
  MALFORMED_REQUEST: 'The device could not understand the request. This is a bug in the workspace; please report it.',
  UNKNOWN_OPERATION: 'The device does not know that operation. It may run a different software version.',
  UNSUPPORTED_VERSION: 'The device and this workspace speak different protocol versions.',
  CHANNEL_NOT_CONFIGURED: 'Set a bit rate on this channel first.',
  CHANNEL_BUSY: 'Stop capturing before changing the bit rate.',
  BUS_OFF: 'The channel has gone bus-off because of bus errors, so it cannot send. Check the wiring, bit rate and termination.',
  TX_QUEUE_FULL: 'The device is busy and could not accept another frame. Try again in a moment.',
  NOT_CONNECTED: 'Not connected to a device.',
  DEVICE_DISCONNECTED: 'The connection to the device was lost.',
  TIMEOUT: 'The device did not answer in time.',
  INTERNAL_ERROR: 'The device reported an internal fault.',
};

export function describeErrorCode(code: ErrorCode): string {
  return PLAIN[code];
}
