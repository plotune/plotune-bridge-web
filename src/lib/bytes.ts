export function bytesToHex(bytes: Uint8Array, separator = ''): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(separator);
}

/** Lenient input parsing for user-entered hex: spaces, commas and 0x prefixes are ignored. Returns null if invalid. */
export function parseHexBytes(text: string): Uint8Array | null {
  const cleaned = text.replace(/0x/gi, '').replace(/[\s,:_-]/g, '');
  if (cleaned.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(cleaned)) return null;
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(cleaned.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function parseHexNumber(text: string): number | null {
  const cleaned = text.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(cleaned) || cleaned.length > 8) return null;
  return parseInt(cleaned, 16);
}

export function formatId(id: number, extended: boolean): string {
  return id.toString(16).toUpperCase().padStart(extended ? 8 : 3, '0');
}

/** Relative device time as seconds with microseconds, computed on BigInt so no precision is lost. */
export function formatRelativeNs(timestampNs: bigint, originNs: bigint): string {
  const delta = timestampNs - originNs;
  const negative = delta < 0n;
  const abs = negative ? -delta : delta;
  const seconds = abs / 1_000_000_000n;
  const micros = (abs % 1_000_000_000n) / 1000n;
  return `${negative ? '-' : ''}${seconds}.${micros.toString().padStart(6, '0')}`;
}

/** Hex dump, 8 bytes per line, for memory reads. */
export function memoryDump(address: number, bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8) {
    const chunk = bytes.subarray(offset, offset + 8);
    lines.push(`${(address + offset).toString(16).toUpperCase().padStart(8, '0')}: ${bytesToHex(chunk, ' ').toUpperCase()}`);
  }
  return lines.join('\n');
}
