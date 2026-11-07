import { describe, expect, it } from 'vitest';
import { ContractError } from '../src/protocol/errors';
import type { TxFrame } from '../src/protocol/types';
import { validateTxFrame } from '../src/protocol/validate';

const frame = (over: Partial<TxFrame> = {}): TxFrame => ({
  channel: 1, id: 0x123, extended: false, rtr: false, dlc: 2, data: Uint8Array.of(1, 2), ...over,
});

const code = (over: Partial<TxFrame>, capabilities: { canFd?: boolean } = {}): string => {
  try {
    validateTxFrame(frame(over), capabilities);
    return 'ok';
  } catch (error) {
    return error instanceof ContractError ? error.code : String(error);
  }
};

describe('validateTxFrame: Classical CAN', () => {
  it('accepts a data frame', () => {
    expect(code({})).toBe('ok');
  });

  it('accepts an RTR frame with no data', () => {
    expect(code({ rtr: true, dlc: 5, data: new Uint8Array() })).toBe('ok');
  });

  it('rejects a DLC above 8', () => {
    expect(code({ dlc: 9, data: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9) })).toBe('INVALID_DLC');
  });

  it('rejects a data length that does not match the DLC', () => {
    expect(code({ dlc: 3, data: Uint8Array.of(1, 2) })).toBe('INVALID_DLC');
  });

  it('rejects data on an RTR frame', () => {
    expect(code({ rtr: true, dlc: 2, data: Uint8Array.of(1, 2) })).toBe('INVALID_DLC');
  });

  it('rejects a negative or non-integer DLC', () => {
    expect(code({ dlc: -1, data: new Uint8Array() })).toBe('INVALID_DLC');
    expect(code({ dlc: 1.5, data: new Uint8Array() })).toBe('INVALID_DLC');
  });
});

describe('validateTxFrame: CAN FD', () => {
  it.each([[9, 12], [10, 16], [11, 20], [12, 24], [13, 32], [14, 48], [15, 64]])('accepts FD DLC %i with %i payload bytes', (dlc, length) => {
    expect(code({ fd: true, dlc, data: new Uint8Array(length) }, { canFd: true })).toBe('ok');
  });

  it('accepts FD when the device capability is not known yet', () => {
    expect(code({ fd: true, dlc: 9, data: new Uint8Array(12) })).toBe('ok');
  });

  it('rejects BRS without FD', () => {
    expect(code({ brs: true })).toBe('MALFORMED_REQUEST');
  });

  it('rejects ESI without FD', () => {
    expect(code({ esi: true })).toBe('MALFORMED_REQUEST');
  });

  it('rejects an FD remote frame', () => {
    expect(code({ fd: true, rtr: true, dlc: 9, data: new Uint8Array() }, { canFd: true })).toBe('INVALID_DATA');
  });

  it('rejects a non-canonical FD payload length', () => {
    expect(code({ fd: true, dlc: 9, data: new Uint8Array(9) }, { canFd: true })).toBe('INVALID_DLC');
  });

  it('rejects an FD payload that is shorter than the DLC length', () => {
    expect(code({ fd: true, dlc: 15, data: new Uint8Array(63) }, { canFd: true })).toBe('INVALID_DLC');
  });

  it('rejects an FD DLC above 15', () => {
    expect(code({ fd: true, dlc: 16, data: new Uint8Array(64) }, { canFd: true })).toBe('INVALID_DLC');
  });

  it('rejects an FD frame when the connected device advertises Classical CAN only', () => {
    expect(code({ fd: true, dlc: 9, data: new Uint8Array(12) }, { canFd: false })).toBe('UNSUPPORTED_FEATURE');
  });
});
