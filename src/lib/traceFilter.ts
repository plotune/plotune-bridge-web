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

export function frameMatches(frame: CanFrame, f: TraceFilter): boolean {
  if (f.channel !== null && frame.channel !== f.channel) return false;
  if (f.direction !== null && frame.direction !== f.direction) return false;
  const q = f.text.trim().toLowerCase().replace(/^0x/, '');
  if (q === '') return true;
  const idHex = frame.id.toString(16);
  if (idHex.includes(q) || String(frame.id) === q) return true;
  const dataHex = bytesToHex(frame.data, ' ');
  return dataHex.includes(q) || dataHex.replace(/ /g, '').includes(q.replace(/\s/g, ''));
}

/** Frames follow the filter. Markers (drops, gaps, connection notes) always stay: a filter must never hide a loss. */
export function rowMatches(row: TraceRow, f: TraceFilter): boolean {
  return row.kind === 'frame' ? frameMatches(row.frame, f) : true;
}
