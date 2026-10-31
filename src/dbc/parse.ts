import { DbcError, type Dbc, type DbcMessage, type DbcSignal, type Multiplexing } from './types';

const EXTENDED_FLAG = 0x8000_0000;
const MAX_ID = 0x1fff_ffff;
export const MAX_DBC_BYTES = 5 * 1024 * 1024;

const BO = /^BO_\s+(\d+)\s+([A-Za-z_]\w*)\s*:\s*(\d+)\s+(\S+)/;
const SG = /^SG_\s+([A-Za-z_]\w*)\s*(M|m\d+M?)?\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\(\s*([^,\s]+)\s*,\s*([^)\s]+)\s*\)\s*\[\s*([^|\s]*)\s*\|\s*([^\]\s]*)\s*\]\s*"([^"]*)"/;
const VAL = /^VAL_\s+(\d+)\s+([A-Za-z_]\w*)\s+(.*);\s*$/;
const VALTYPE = /^SIG_VALTYPE_\s+(\d+)\s+([A-Za-z_]\w*)\s*:\s*([012])\s*;/;
const LONG_SIGNAL = /^BA_\s+"SystemSignalLongSymbol"\s+SG_\s+(\d+)\s+([A-Za-z_]\w*)\s+"([^"]+)"\s*;/;
const LONG_MESSAGE = /^BA_\s+"SystemMessageLongSymbol"\s+BO_\s+(\d+)\s+"([^"]+)"\s*;/;
const LABEL = /(-?\d+)\s+"([^"]*)"/g;

function num(text: string, what: string, line: number): number {
  const value = Number(text);
  if (!Number.isFinite(value)) throw new DbcError(`Line ${line}: ${what} "${text}" is not a number.`);
  return value;
}

function multiplexing(tag: string | undefined, warnings: string[], signal: string): Multiplexing {
  if (!tag) return { kind: 'none' };
  if (tag === 'M') return { kind: 'switch' };
  if (tag.endsWith('M')) {
    warnings.push(`Signal ${signal} uses extended multiplexing (${tag}); it is shown without a multiplexer condition.`);
    return { kind: 'none' };
  }
  return { kind: 'muxed', value: Number(tag.slice(1)) };
}

/**
 * Reads the parts of a DBC file Bridge needs to decode frames: messages, signals (layout, scaling, unit,
 * multiplexing), value tables (VAL_) and float types (SIG_VALTYPE_). Everything else (comments, attributes,
 * nodes) is skipped. Features that are not supported yet are reported in `warnings`, never silently dropped.
 */
export function parseDbc(text: string): Dbc {
  if (text.length > MAX_DBC_BYTES) throw new DbcError('This file is larger than 5 MB, which is too big for a DBC file.');
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\r|\n/);
  const warnings: string[] = [];
  const messages: DbcMessage[] = [];
  const byKey = new Map<string, DbcMessage>();
  const key = (id: number, extended: boolean) => `${extended ? 'x' : 's'}${id}`;
  const rawIdToMessage = new Map<number, DbcMessage>();
  let current: DbcMessage | null = null;
  let inComment = false;
  let sawMuxExtended = false;
  // Vector tools cap names at 32 characters and keep the full name in an attribute; applied once the file is read.
  const longSignals: { id: number; short: string; long: string }[] = [];
  const longMessages: { id: number; long: string }[] = [];

  lines.forEach((full, index) => {
    const lineNo = index + 1;
    const line = full.trim();
    if (inComment) {
      // A multi-line CM_ string: skip until the closing quote.
      if ((line.match(/(?<!\\)"/g)?.length ?? 0) % 2 === 1) inComment = false;
      return;
    }
    if (line.startsWith('CM_')) {
      if ((line.match(/(?<!\\)"/g)?.length ?? 0) % 2 === 1) inComment = true;
      return;
    }
    let m: RegExpMatchArray | null;
    if ((m = BO.exec(line))) {
      const rawId = Number(m[1]);
      const extended = rawId >= EXTENDED_FLAG;
      const id = extended ? rawId - EXTENDED_FLAG : rawId;
      if (id > MAX_ID) throw new DbcError(`Line ${lineNo}: message ${m[2]} has an identifier that is too large.`);
      if (!extended && id > 0x7ff) {
        warnings.push(`Message ${m[2]} has the standard identifier ${id}, which is larger than 0x7FF; it is read as a standard frame and will not match.`);
      }
      const message: DbcMessage = { id, extended, name: m[2], dlc: Number(m[3]), transmitter: m[4], signals: [] };
      if (m[2] !== 'VECTOR__INDEPENDENT_SIG_MSG') {
        const k = key(id, extended);
        if (byKey.has(k)) warnings.push(`Message ${m[2]} repeats an identifier already used by ${byKey.get(k)!.name}; the first one is used.`);
        else {
          byKey.set(k, message);
          messages.push(message);
        }
      }
      rawIdToMessage.set(rawId, message);
      current = message;
      return;
    }
    if ((m = SG.exec(line))) {
      if (!current) throw new DbcError(`Line ${lineNo}: signal ${m[1]} comes before any message.`);
      const length = Number(m[4]);
      if (length < 1 || length > 64) {
        // Long text or multi-packet fields exist in real files (J1939). One of them must not block the whole database.
        warnings.push(`Signal ${m[1]} in ${current.name} is ${length} bits long; only 1 to 64 bits are supported, so it is not decoded.`);
        return;
      }
      const signal: DbcSignal = {
        name: m[1],
        startBit: Number(m[3]),
        length,
        byteOrder: m[5] === '1' ? 'intel' : 'motorola',
        signed: m[6] === '-',
        float: null,
        factor: num(m[7], 'factor', lineNo),
        offset: num(m[8], 'offset', lineNo),
        min: m[9] === '' ? 0 : num(m[9], 'minimum', lineNo),
        max: m[10] === '' ? 0 : num(m[10], 'maximum', lineNo),
        unit: m[11],
        mux: multiplexing(m[2], warnings, m[1]),
        labels: new Map(),
      };
      current.signals.push(signal);
      return;
    }
    if (line.startsWith('SG_MUL_VAL_')) {
      sawMuxExtended = true;
      return;
    }
    if ((m = LONG_SIGNAL.exec(line))) {
      longSignals.push({ id: Number(m[1]), short: m[2], long: m[3] });
      return;
    }
    if ((m = LONG_MESSAGE.exec(line))) {
      longMessages.push({ id: Number(m[1]), long: m[2] });
      return;
    }
    if ((m = VAL.exec(line))) {
      const message = rawIdToMessage.get(Number(m[1]));
      const signal = message?.signals.find((s) => s.name === m![2]);
      if (!signal) return; // Value tables for environment variables or unknown signals are not used.
      const labels = new Map<number, string>();
      for (const pair of m[3].matchAll(LABEL)) labels.set(Number(pair[1]), pair[2]);
      (signal as { labels: ReadonlyMap<number, string> }).labels = labels;
      return;
    }
    if ((m = VALTYPE.exec(line))) {
      const signal = rawIdToMessage.get(Number(m[1]))?.signals.find((s) => s.name === m![2]);
      if (!signal || m[3] === '0') return;
      const bits = m[3] === '1' ? 32 : 64;
      if (signal.length !== bits) warnings.push(`Signal ${signal.name} is marked as a ${bits}-bit float but is ${signal.length} bits long; it is read as an integer.`);
      else signal.float = bits;
    }
  });

  for (const { id, long } of longMessages) {
    const message = rawIdToMessage.get(id);
    if (message) message.name = long;
  }
  for (const { id, short, long } of longSignals) {
    const signal = rawIdToMessage.get(id)?.signals.find((x) => x.name === short);
    if (signal) signal.name = long;
  }
  if (sawMuxExtended) warnings.push('This file uses extended multiplexing (SG_MUL_VAL_). Those signals are decoded without their multiplexer condition.');
  if (messages.length === 0) throw new DbcError('No messages found. Is this a DBC file?');
  return { messages, warnings };
}
