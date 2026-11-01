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

/** The query as it appears in the table: trimmed, without a 0x prefix. Empty means nothing to highlight. */
export function highlightQuery(text: string): string {
  return text.trim().replace(/^0x/i, '');
}

/** Splits `text` around every case-insensitive occurrence of `query`, so the parts can be marked. */
export function splitMatches(text: string, query: string): { text: string; match: boolean }[] {
  if (query === '') return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}

export const RECENT_FILTERS_KEY = 'bw.trace.recent';
const MAX_RECENT = 6;
const MAX_RECENT_LENGTH = 40;

/** The most recent filter texts, newest first, without repeats (ignoring case) or blanks. */
export function rememberRecent(list: readonly string[], text: string): string[] {
  const value = text.trim();
  if (value.length < 2 || value.length > MAX_RECENT_LENGTH) return [...list];
  return [value, ...list.filter((entry) => entry.toLowerCase() !== value.toLowerCase())].slice(0, MAX_RECENT);
}

/** Reads the remembered filters, ignoring anything that is not a short list of short strings. */
export function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length >= 2 && entry.length <= MAX_RECENT_LENGTH).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}
