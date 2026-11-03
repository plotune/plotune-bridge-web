// Turning data into recordings: a window of the Scope's series, or a CSV file (the Scope's own export, or one column per signal).
import { newId } from '../workspace/layout';
import type { Series } from '../plot/series';
import type { Recording, SignalData } from './math';

export class CsvError extends Error {}
export const MAX_CSV_BYTES = 30_000_000;
export const MAX_CSV_ROWS = 1_500_000;
export const MAX_RECORDING_SIGNALS = 64;

export const looksBoolean = (v: Float64Array, unit: string): boolean => {
  if (unit !== '' || v.length === 0) return false;
  for (let i = 0; i < v.length; i += 1) if (v[i] !== 0 && v[i] !== 1) return false;
  return true;
};

/** Rows of fields. Handles quoted fields, doubled quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      if (rows.length > MAX_CSV_ROWS) throw new CsvError('That file has too many rows to open here.');
    } else field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

interface Collected { label: string; unit: string; t: number[]; v: number[] }

function finish(name: string, collected: Map<string, Collected>, source: Recording['source']): Recording {
  if (collected.size === 0) throw new CsvError('No samples were found in that file.');
  if (collected.size > MAX_RECORDING_SIGNALS) throw new CsvError(`That file has more than ${MAX_RECORDING_SIGNALS} signals.`);
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const c of collected.values()) for (const t of c.t) { if (t < t0) t0 = t; if (t > t1) t1 = t; }
  const signals: Record<string, SignalData> = {};
  for (const [key, c] of collected) {
    const order = c.t.map((_, i) => i).sort((a, b) => c.t[a]! - c.t[b]!);
    const t = Float64Array.from(order, (i) => c.t[i]! - t0);
    const v = Float64Array.from(order, (i) => c.v[i]!);
    signals[key] = { key, label: c.label, unit: c.unit, decimals: 2, bool: looksBoolean(v, c.unit), t, v };
  }
  return { id: newId('r'), name, created: Date.now(), source, duration: Math.max(t1 - t0, 1e-6), signals, events: [] };
}

/**
 * The Scope's own CSV export (time_s, channel, message, signal, value, unit), or a file with a time column first and one column
 * per signal ("Speed [km/h]" or "Speed (km/h)" puts the unit in the name).
 */
export function recordingFromCsv(text: string, name: string): Recording {
  if (text.length > MAX_CSV_BYTES) throw new CsvError('That file is too large to open here.');
  const rows = parseCsv(text);
  const head = rows[0]?.map((h) => h.trim());
  if (!head || rows.length < 2) throw new CsvError('That does not look like a CSV file with a header and samples.');
  const collected = new Map<string, Collected>();
  const longForm = head.length >= 5 && head[0]!.toLowerCase().startsWith('time') && head.slice(1, 5).join(',').toLowerCase() === 'channel,message,signal,value';
  if (longForm) {
    for (const r of rows.slice(1)) {
      const t = Number(r[0]);
      const v = Number(r[4]);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      const key = `${r[1]}:${r[2]}.${r[3]}`;
      let c = collected.get(key);
      if (!c) collected.set(key, (c = { label: `${r[3]}`, unit: r[5] ?? '', t: [], v: [] }));
      c.t.push(t);
      c.v.push(v);
    }
  } else {
    if (!/^t(ime)?([_ ]?(s|ms))?$/i.test(head[0]!)) throw new CsvError('The first column must be the time in seconds.');
    const scale = /ms$/i.test(head[0]!) ? 1e-3 : 1;
    head.slice(1).forEach((h, i) => {
      const m = /^(.*?)\s*[[(]([^\])]*)[\])]\s*$/.exec(h);
      const label = (m ? m[1]! : h).trim() || `Signal ${i + 1}`;
      collected.set(`col${i}`, { label, unit: m ? m[2]!.trim() : '', t: [], v: [] });
    });
    for (const r of rows.slice(1)) {
      const t = Number(r[0]) * scale;
      if (!Number.isFinite(t)) continue;
      head.slice(1).forEach((_, i) => {
        const cell = r[i + 1];
        if (cell === undefined || cell.trim() === '') return;
        const v = Number(cell);
        if (!Number.isFinite(v)) return;
        const c = collected.get(`col${i}`)!;
        c.t.push(t);
        c.v.push(v);
      });
    }
    for (const [k, c] of [...collected]) if (c.t.length === 0) collected.delete(k);
  }
  return finish(name, collected, 'import');
}

/** A window of the Scope's series as a recording, with times counted from the start of the window. */
export function recordingFromSeries(series: readonly Series[], t0: number, t1: number, name: string): Recording | null {
  const collected = new Map<string, Collected>();
  for (const s of series) {
    const c: Collected = { label: s.key.signal, unit: s.key.unit, t: [], v: [] };
    for (let i = s.lowerBound(t0); i < s.length && s.timeAt(i) <= t1; i += 1) { c.t.push(s.timeAt(i)); c.v.push(s.valueAt(i)); }
    if (c.t.length > 0) collected.set(`CAN${s.key.channel}:${s.key.messageName}.${s.key.signal}`, c);
  }
  if (collected.size === 0) return null;
  const r = finish(name, collected, 'scope');
  r.duration = Math.max(r.duration, t1 - t0 > 0 ? Math.min(t1 - t0, r.duration) : r.duration);
  return r;
}
