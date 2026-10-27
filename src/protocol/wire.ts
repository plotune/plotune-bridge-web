// JSON text <-> wire objects, losslessly for the nanosecond fields.
//
// The contract encodes timestamp_ns, since_ns, monotonic_ns and wall_clock_ns as plain JSON integers that
// routinely exceed 2^53, where JSON.parse silently rounds. SPEC section 1 requires them to be read as 64-bit
// integers. The wire encoding is not changed: the digits are quoted before parsing and turned into BigInt after.
import { ProtocolViolation } from './errors';
import { UINT64_MAX } from './types';

export const NS_FIELDS = ['timestamp_ns', 'since_ns', 'monotonic_ns', 'wall_clock_ns'] as const;
const NS_PATTERN = new RegExp(`"(${NS_FIELDS.join('|')})"\\s*:\\s*(\\d+)`, 'g');
const MARK = '~u64~';

export type WireObject = { [key: string]: unknown };

export function parseWire(text: string): WireObject {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(NS_PATTERN, (_m, key: string, digits: string) => `"${key}":"${MARK}${digits}"`));
  } catch {
    throw new ProtocolViolation('message is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProtocolViolation('message is not a JSON object');
  convert(value);
  return value as WireObject;
}

function convert(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(convert);
  } else if (node !== null && typeof node === 'object') {
    const record = node as WireObject;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if ((NS_FIELDS as readonly string[]).includes(key) && typeof value === 'string' && value.startsWith(MARK)) {
        const big = BigInt(value.slice(MARK.length));
        if (big > UINT64_MAX) throw new ProtocolViolation(`${key} exceeds the unsigned 64-bit range`);
        record[key] = big;
      } else {
        convert(value);
      }
    }
  }
}

/** Requests carry no nanosecond fields, so plain JSON is exact. */
export function encodeWire(message: WireObject): string {
  return JSON.stringify(message);
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
