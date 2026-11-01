import type { Dbc, DbcMessage, DbcSignal, DecodedSignal } from './types';

/** A lookup by identifier and frame format. Build it once per loaded file. */
export function indexMessages(dbc: Dbc): (id: number, extended: boolean) => DbcMessage | undefined {
  const map = new Map<string, DbcMessage>();
  for (const message of dbc.messages) map.set(`${message.extended ? 'x' : 's'}${message.id}`, message);
  return (id, extended) => map.get(`${extended ? 'x' : 's'}${id}`);
}

/** The raw bits of a signal as an unsigned integer. Returns null when the frame is too short to hold the signal. */
export function extractRaw(signal: DbcSignal, data: Uint8Array): bigint | null {
  const bitAt = (position: number): bigint | null => {
    const byte = position >> 3;
    if (byte >= data.length) return null;
    return BigInt((data[byte] >> (position & 7)) & 1);
  };
  let raw = 0n;
  if (signal.byteOrder === 'intel') {
    for (let i = 0; i < signal.length; i += 1) {
      const bit = bitAt(signal.startBit + i);
      if (bit === null) return null;
      raw |= bit << BigInt(i);
    }
    return raw;
  }
  // Motorola: the start bit is the most significant bit; within a byte the numbering counts down,
  // and after bit 0 the signal continues at bit 7 of the next byte.
  let position = signal.startBit;
  for (let i = 0; i < signal.length; i += 1) {
    const bit = bitAt(position);
    if (bit === null) return null;
    raw = (raw << 1n) | bit;
    position = (position & 7) === 0 ? position + 15 : position - 1;
  }
  return raw;
}

function toNumber(signal: DbcSignal, raw: bigint): number {
  if (signal.float === 32 || signal.float === 64) {
    const view = new DataView(new ArrayBuffer(8));
    if (signal.float === 32) {
      view.setUint32(0, Number(raw));
      return view.getFloat32(0);
    }
    view.setBigUint64(0, raw);
    return view.getFloat64(0);
  }
  if (signal.signed) {
    const signBit = 1n << BigInt(signal.length - 1);
    return Number(raw & signBit ? raw - (signBit << 1n) : raw);
  }
  return Number(raw);
}

/**
 * Decodes the signals of one frame. A multiplexed signal appears only when its switch has the matching value.
 * Signals that do not fit in the frame are left out, never guessed.
 */
export function decodeMessage(message: DbcMessage, data: Uint8Array): DecodedSignal[] {
  const out: DecodedSignal[] = [];
  const rawOf = new Map<DbcSignal, bigint>();
  for (const signal of message.signals) {
    const raw = extractRaw(signal, data);
    if (raw !== null) rawOf.set(signal, raw);
  }
  const switchSignal = message.signals.find((s) => s.mux.kind === 'switch');
  const switchValue = switchSignal && rawOf.has(switchSignal) ? Number(rawOf.get(switchSignal)) : null;
  for (const signal of message.signals) {
    const raw = rawOf.get(signal);
    if (raw === undefined) continue;
    if (signal.mux.kind === 'muxed' && signal.mux.value !== switchValue) continue;
    const physical = toNumber(signal, raw);
    const rawNumber = signal.float ? physical : Number(signal.signed ? BigInt.asIntN(signal.length, raw) : raw);
    out.push({ name: signal.name, value: physical * signal.factor + signal.offset, raw, unit: signal.unit, label: signal.labels.get(rawNumber) });
  }
  return out;
}

/**
 * Decodes only the named signals of one frame (a plot needs a few signals, not all of a large message). Multiplexing follows
 * the same rule as decodeMessage: a multiplexed signal appears only when its switch matches. The result equals the
 * matching entries of decodeMessage, in message order.
 */
export function decodeSelected(message: DbcMessage, data: Uint8Array, wanted: ReadonlySet<string>): DecodedSignal[] {
  const out: DecodedSignal[] = [];
  let switchValue: number | null | undefined;
  for (const signal of message.signals) {
    if (!wanted.has(signal.name)) continue;
    if (signal.mux.kind === 'muxed') {
      if (switchValue === undefined) {
        const selector = message.signals.find((x) => x.mux.kind === 'switch');
        const raw = selector ? extractRaw(selector, data) : null;
        switchValue = raw === null ? null : Number(raw);
      }
      if (signal.mux.value !== switchValue) continue;
    }
    const raw = extractRaw(signal, data);
    if (raw === null) continue;
    const physical = toNumber(signal, raw);
    const rawNumber = signal.float ? physical : Number(signal.signed ? BigInt.asIntN(signal.length, raw) : raw);
    out.push({ name: signal.name, value: physical * signal.factor + signal.offset, raw, unit: signal.unit, label: signal.labels.get(rawNumber) });
  }
  return out;
}
