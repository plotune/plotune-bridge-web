import { bytesToHex, formatId } from './bytes';
import type { CanFrame } from '../protocol/types';
import type { TraceRow } from '../state/trace';

export type Radix = 'hex' | 'dec';

export interface TraceFilter {
  /** Matches the ID (hex or decimal) or the data bytes. Empty matches everything. */
  text: string;
  channel: number | null;
  direction: 'rx' | 'tx' | null;
}

export const NO_FILTER: TraceFilter = { text: '', channel: null, direction: null };

export function filterActive(f: TraceFilter): boolean {
  return f.text.trim() !== '' || f.channel !== null || f.direction !== null;
}

export function formatTraceId(id: number, extended: boolean, radix: Radix): string {
  return radix === 'hex' ? formatId(id, extended) : String(id);
}

export function formatTraceData(data: Uint8Array, radix: Radix): string {
  return radix === 'hex' ? bytesToHex(data, ' ').toUpperCase() : Array.from(data, (b) => String(b)).join(' ');
}

/** Matches what the trace shows, in either number format: padded hex ID (001, 000007E8), plain hex, decimal ID, and the data bytes in hex or decimal. */
/** `names` returns the lower-case message and signal names of a frame, so the filter can match what a database shows. */
export function frameMatches(frame: CanFrame, f: TraceFilter, names?: (frame: CanFrame) => string): boolean {
  if (f.channel !== null && frame.channel !== f.channel) return false;
  if (f.direction !== null && frame.direction !== f.direction) return false;
  const q = f.text.trim().toLowerCase().replace(/^0x/, '');
  if (q === '') return true;
  if (formatId(frame.id, frame.extended).toLowerCase().includes(q) || frame.id.toString(16).includes(q) || String(frame.id) === q) return true;
  if (names && names(frame).includes(f.text.trim().toLowerCase())) return true;
  const squash = (v: string) => v.replace(/\s/g, '');
  const hex = bytesToHex(frame.data, ' ');
  const dec = Array.from(frame.data, (b) => String(b)).join(' ');
  return hex.includes(q) || squash(hex).includes(squash(q)) || dec.includes(q);
}

/** Frames follow the filter. Markers (drops, gaps, connection notes) always stay: a filter must never hide a loss. */
export function rowMatches(row: TraceRow, f: TraceFilter, names?: (frame: CanFrame) => string): boolean {
  return row.kind === 'frame' ? frameMatches(row.frame, f, names) : true;
}
