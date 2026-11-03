// Reading CAN logs for analysis: Vector ASC, candump and BLF (Classic CAN). The same shapes the recorder writes, and what other tools write.
export class LogError extends Error {}

export const MAX_LOG_BYTES = 400_000_000;
export const MAX_LOG_FRAMES = 6_000_000;

/** Frames of a log in typed arrays, so millions of them stay small. Time is seconds from the first frame. */
export interface LogFrames {
  count: number;
  t: Float64Array;
  channel: Uint8Array;
  /** Identifier without the extended flag. */
  id: Uint32Array;
  extended: Uint8Array;
  /** 8 bytes per frame; unused bytes are zero. */
  data: Uint8Array;
  dlc: Uint8Array;
  rtr: Uint8Array;
}
export type LogFormat = 'asc' | 'candump' | 'blf';
export interface CanLog {
  format: LogFormat;
  frames: LogFrames;
  /** Channel number to number of frames. */
  channels: Map<number, number>;
  duration: number;
}

class Builder {
  count = 0;
  private cap = 4096;
  t = new Float64Array(this.cap);
  channel = new Uint8Array(this.cap);
  id = new Uint32Array(this.cap);
  extended = new Uint8Array(this.cap);
  data = new Uint8Array(this.cap * 8);
  dlc = new Uint8Array(this.cap);
  rtr = new Uint8Array(this.cap);
  push(t: number, channel: number, id: number, extended: boolean, rtr: boolean, dlc: number, bytes: ArrayLike<number>): void {
    if (this.count >= MAX_LOG_FRAMES) throw new LogError('That log has too many frames to open here.');
    if (this.count === this.cap) this.grow();
    const i = this.count++;
    this.t[i] = t; this.channel[i] = channel; this.id[i] = id; this.extended[i] = extended ? 1 : 0; this.rtr[i] = rtr ? 1 : 0; this.dlc[i] = dlc;
    for (let k = 0; k < 8 && k < bytes.length; k += 1) this.data[i * 8 + k] = bytes[k]!;
  }
  private grow(): void {
    this.cap *= 2;
    const g = <T extends Float64Array | Uint8Array | Uint32Array>(a: T, mult = 1): T => { const n = new (a.constructor as new (n: number) => T)(this.cap * mult); n.set(a); return n; };
    this.t = g(this.t); this.channel = g(this.channel); this.id = g(this.id); this.extended = g(this.extended); this.data = g(this.data, 8); this.dlc = g(this.dlc); this.rtr = g(this.rtr);
  }
  finish(format: LogFormat): CanLog {
    const n = this.count;
    if (n === 0) throw new LogError('No CAN frames were found in that file.');
    // Logs are in time order, but a merged log may not be: sort only when needed.
    let sorted = true;
    for (let i = 1; i < n; i += 1) if (this.t[i]! < this.t[i - 1]!) { sorted = false; break; }
    const order = sorted ? null : Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => this.t[a]! - this.t[b]!);
    const pick = <T extends Float64Array | Uint8Array | Uint32Array>(a: T, w = 1): T => {
      const out = new (a.constructor as new (n: number) => T)(n * w);
      if (!order) out.set(a.subarray(0, n * w));
      else for (let i = 0; i < n; i += 1) for (let k = 0; k < w; k += 1) out[i * w + k] = a[order[i]! * w + k]!;
      return out;
    };
    const t = pick(this.t);
    const t0 = t[0]!;
    for (let i = 0; i < n; i += 1) t[i] = t[i]! - t0;
    const frames: LogFrames = { count: n, t, channel: pick(this.channel), id: pick(this.id), extended: pick(this.extended), data: pick(this.data, 8), dlc: pick(this.dlc), rtr: pick(this.rtr) };
    const channels = new Map<number, number>();
    for (let i = 0; i < n; i += 1) channels.set(frames.channel[i]!, (channels.get(frames.channel[i]!) ?? 0) + 1);
    return { format, frames, channels: new Map([...channels].sort((a, b) => a[0] - b[0])), duration: Math.max(t[n - 1]!, 1e-6) };
  }
}

const hexByte = (s: string) => parseInt(s, 16);

/** Vector ASC: `0.123456 1 7E8 Rx d 8 01 02 ...`, ids with a trailing x are extended, `base dec` files use decimal. */
export function parseAsc(text: string): CanLog {
  const b = new Builder();
  let decimal = false;
  const line = /^\s*(\d+(?:\.\d+)?)\s+(\d+)\s+([0-9A-Za-z]+?)(x?)\s+(?:Rx|Tx)\s+([dr])\s*(\d*)\s*(.*)$/i;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('base ')) { decimal = /base\s+dec/i.test(raw); continue; }
    const m = line.exec(raw);
    if (!m) continue;
    const id = decimal ? parseInt(m[3]!, 10) : hexByte(m[3]!);
    if (!Number.isFinite(id)) continue;
    const dlc = Math.min(8, Number(m[6] || 0));
    const bytes = m[5] === 'd' || m[5] === 'D' ? m[7]!.trim().split(/\s+/).filter(Boolean).slice(0, 8).map((x) => (decimal ? parseInt(x, 10) : hexByte(x))) : [];
    b.push(Number(m[1]), Number(m[2]), id, m[4]!.toLowerCase() === 'x', m[5]!.toLowerCase() === 'r', dlc, bytes);
  }
  return b.finish('asc');
}

/** `candump -l`: `(1234.567890) can0 123#DEADBEEF`. Channel n is can(n-1), as the recorder writes it. */
export function parseCandump(text: string): CanLog {
  const b = new Builder();
  const line = /^\s*\((\d+(?:\.\d+)?)\)\s+\S*?(\d+)\s+([0-9A-Fa-f]+)#(R|[0-9A-Fa-f]*)/;
  for (const raw of text.split(/\r?\n/)) {
    const m = line.exec(raw);
    if (!m) continue;
    const idText = m[3]!;
    const rtr = m[4] === 'R';
    const bytes: number[] = [];
    if (!rtr) for (let i = 0; i + 1 < m[4]!.length && bytes.length < 8; i += 2) bytes.push(hexByte(m[4]!.slice(i, i + 2)));
    b.push(Number(m[1]), Number(m[2]) + 1, parseInt(idText, 16), idText.length > 3, rtr, bytes.length, bytes);
  }
  return b.finish('candump');
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** BLF: log containers (type 10, zlib) of CAN message objects (types 1 and 86). Other object types are skipped. */
export async function parseBlf(bytes: Uint8Array): Promise<CanLog> {
  if (bytes.length < 144 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'LOGG') throw new LogError('That is not a BLF file.');
  const b = new Builder();
  const readObjects = (buf: Uint8Array, container: boolean): number => {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let at = 0;
    while (at + 16 <= buf.length) {
      if (buf[at] !== 0x4c || buf[at + 1] !== 0x4f || buf[at + 2] !== 0x42 || buf[at + 3] !== 0x4a) { at += 1; continue; }
      const size = v.getUint32(at + 8, true);
      const type = v.getUint32(at + 12, true);
      if (size < 16 || at + size > buf.length) break;
      if ((type === 1 || type === 86) && size >= 40) {
        const flags = v.getUint32(at + 16, true);
        const stamp = Number(v.getBigUint64(at + 24, true));
        const t = flags === 1 ? stamp * 1e-5 : stamp * 1e-9;
        const f = v.getUint8(at + 34);
        const dlc = Math.min(8, v.getUint8(at + 35));
        const raw = v.getUint32(at + 36, true);
        b.push(t, v.getUint16(at + 32, true), (raw & 0x1fff_ffff) >>> 0, (raw & 0x8000_0000) !== 0, (f & 0x80) !== 0, dlc, buf.subarray(at + 40, at + 48));
      }
      at += size + (size % 4);
    }
    void container;
    return at;
  };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = v.getUint32(4, true);
  let carry: Uint8Array = new Uint8Array(0);
  while (at + 16 <= bytes.length) {
    if (bytes[at] !== 0x4c || bytes[at + 1] !== 0x4f || bytes[at + 2] !== 0x42 || bytes[at + 3] !== 0x4a) { at += 1; continue; }
    const size = v.getUint32(at + 8, true);
    const type = v.getUint32(at + 12, true);
    if (size < 16 || at + size > bytes.length) break;
    if (type === 10) {
      const method = v.getUint16(at + 16, true);
      const body = bytes.subarray(at + 32, at + size);
      const raw = method === 2 ? await inflate(body) : body;
      const joined = carry.length ? Uint8Array.from([...carry, ...raw]) : raw;
      const used = readObjects(joined, true);
      carry = joined.slice(used);
    } else {
      readObjects(bytes.subarray(at, at + size), false);
    }
    at += size + (size % 4);
  }
  return b.finish('blf');
}

/** What a file looks like by its name and first bytes. */
export function logFormatOf(name: string, head: Uint8Array): LogFormat | 'csv' | 'parquet' | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (head.length >= 4 && String.fromCharCode(...head.subarray(0, 4)) === 'LOGG') return 'blf';
  if (head.length >= 4 && String.fromCharCode(...head.subarray(0, 4)) === 'PAR1') return 'parquet';
  if (ext === 'asc') return 'asc';
  if (ext === 'blf') return 'blf';
  if (ext === 'log') return 'candump';
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (ext === 'parquet') return 'parquet';
  return null;
}

export async function readLog(file: File): Promise<CanLog> {
  if (file.size > MAX_LOG_BYTES) throw new LogError('That file is too large to open here.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = logFormatOf(file.name, bytes.subarray(0, 4));
  if (kind === 'blf') return parseBlf(bytes);
  const text = new TextDecoder('utf-8').decode(bytes);
  if (kind === 'candump') return parseCandump(text);
  return parseAsc(text);
}
