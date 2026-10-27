import { parseHexNumber } from '../lib/bytes';
import { MAX_EXTENDED_ID, MAX_STANDARD_ID } from '../protocol/types';
import type { IsoTpConfig } from './isotp';
import type { XcpConfig } from './xcp';

export interface DiagSettings {
  channel: number;
  udsRequestId: string;
  udsResponseId: string;
  extended: boolean;
  /** 'none' sends the shortest frame; otherwise every frame is padded to 8 bytes with this byte. */
  padding: '00' | 'AA' | 'none';
  timeoutMs: number;
  xcpRequestId: string;
  xcpResponseId: string;
  xcpPadTo8: boolean;
}

// Conventional example identifiers (ISO 15765-4 physical addressing for UDS; XCP IDs come from the target's A2L, so 600/601 is only a starting point).
export const DEFAULT_DIAG: DiagSettings = {
  channel: 1,
  udsRequestId: '7E0',
  udsResponseId: '7E8',
  extended: false,
  padding: '00',
  timeoutMs: 1000,
  xcpRequestId: '600',
  xcpResponseId: '601',
  xcpPadTo8: false,
};

type Result<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

function id(text: string, extended: boolean, label: string): Result<number> {
  const n = parseHexNumber(text);
  if (n === null) return { error: `${label}: use hex digits, for example 7E0.` };
  if (n > (extended ? MAX_EXTENDED_ID : MAX_STANDARD_ID)) return { error: `${label}: too large for ${extended ? 'an extended' : 'a standard'} ID.` };
  return { value: n };
}

export function toIsoTpConfig(s: DiagSettings): Result<IsoTpConfig> {
  const tx = id(s.udsRequestId, s.extended, 'Request ID');
  if (tx.error !== undefined) return { error: tx.error };
  const rx = id(s.udsResponseId, s.extended, 'Response ID');
  if (rx.error !== undefined) return { error: rx.error };
  if (tx.value === rx.value) return { error: 'Request and response IDs must differ.' };
  return { value: { channel: s.channel, txId: tx.value, rxId: rx.value, extended: s.extended, padding: s.padding === 'none' ? null : parseInt(s.padding, 16), timeoutMs: s.timeoutMs, rxBlockSize: 0, rxStMin: 0 } };
}

export function toXcpConfig(s: DiagSettings): Result<XcpConfig> {
  const tx = id(s.xcpRequestId, s.extended, 'XCP command ID');
  if (tx.error !== undefined) return { error: tx.error };
  const rx = id(s.xcpResponseId, s.extended, 'XCP response ID');
  if (rx.error !== undefined) return { error: rx.error };
  if (tx.value === rx.value) return { error: 'XCP command and response IDs must differ.' };
  return { value: { channel: s.channel, requestId: tx.value, responseId: rx.value, extended: s.extended, timeoutMs: s.timeoutMs, padTo8: s.xcpPadTo8 } };
}
