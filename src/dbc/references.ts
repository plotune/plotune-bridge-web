import { safeFileName } from './registry';

/** Portable metadata only. Fingerprint is SHA-256 of the UTF-8 decoded DBC text. */
export interface DatabaseReference { source: string; channel: number; fileName: string; sha256: string }
export async function fingerprint(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseReferences(raw: unknown): DatabaseReference[] | null {
  if (!Array.isArray(raw) || raw.length > 64) return null;
  const out: DatabaseReference[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const r = item as Record<string, unknown>;
    if (Object.keys(r).some((k) => !['source', 'channel', 'fileName', 'sha256'].includes(k))) return null;
    // eslint-disable-next-line no-control-regex
    if (typeof r.source !== 'string' || !r.source.trim() || r.source.length > 60 || r.source.startsWith('log:') || /[\x00-\x1f\x7f]/.test(r.source)) return null;
    if (!Number.isInteger(r.channel) || (r.channel as number) < 1 || (r.channel as number) > 64) return null;
    if (typeof r.fileName !== 'string' || r.fileName !== safeFileName(r.fileName)) return null;
    if (typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256)) return null;
    const key = `${r.source}\0${r.channel}`;
    if (seen.has(key)) return null;
    seen.add(key);
    out.push({ source: r.source, channel: r.channel as number, fileName: r.fileName, sha256: r.sha256 });
  }
  return out;
}
