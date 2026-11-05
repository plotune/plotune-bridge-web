import { parseRemoteTarget } from '../transport/remote';

export interface ParsedTarget {
  ok: boolean;
  /** Normalised ws:// or wss:// URL; empty when not ok. For a remote target, the `remote:<project>/<device>` string itself. */
  url: string;
  scheme: 'ws' | 'wss' | null;
  host: string;
  loopback: boolean;
  /** True for `remote:<projectId>/<deviceUuid>` targets, reached through the Plotune cloud. Absent for direct addresses. */
  remote?: boolean;
  error?: string;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host.toLowerCase()) || host.toLowerCase().endsWith('.localhost');
}

/** One honest rule for every direct address: it must carry an explicit port. No default is assumed. */
const MISSING_PORT_ERROR = 'Add the port, for example 192.168.1.50:9101.';

/**
 * The authority of an address: the part before any path, query or fragment, with an optional scheme removed.
 * Used to tell whether the user typed a port. It cannot be read back from `URL.port`, because the WHATWG URL
 * parser strips a port equal to the scheme default (ws:80, wss:443); we must look at what was actually typed.
 */
function authorityOf(text: string): string {
  const rest = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const end = rest.search(/[/?#]/);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Direct targets (`host:port`, `ws://host:port` or `wss://host:port`) require an explicit port. A bare host, or a
 * `ws://` / `wss://` address with no port, is rejected with one clear message instead of silently becoming
 * `ws://host` (port 80) or `wss://host` (port 443) — ports the Bridge device does not normally listen on. No
 * default port is invented, and the single rule applies to `wss://` too. Remote targets reached through the
 * Plotune cloud (`remote:<project>/<device>`) are not direct addresses and are unchanged.
 */
export function parseTarget(input: string): ParsedTarget {
  const text = input.trim();
  const bad = (error: string): ParsedTarget => ({ ok: false, url: '', scheme: null, host: '', loopback: false, error });
  if (!text) return bad('Enter the device address, for example 192.168.1.50:9101.');
  // Only a well-formed remote target is recognised; any other text keeps its direct-address meaning.
  if (parseRemoteTarget(text)) return { ok: true, url: text, scheme: null, host: '', loopback: false, remote: true };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  if (hasScheme && !/^wss?:\/\//i.test(text)) return bad('Use a ws:// or wss:// address.');
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `ws://${text}`);
  } catch {
    return bad('That is not a valid address.');
  }
  if (!url.hostname) return bad('The address needs a host name or IP address.');
  const scheme = url.protocol === 'wss:' ? 'wss' : 'ws';
  if (url.username || url.password) return bad('Do not put credentials in the address.');
  // Read the port from the typed authority: url.port is empty for a default port as well as for no port at all.
  const port = /:(\d+)$/.exec(authorityOf(text))?.[1] ?? null;
  if (!port) return bad(MISSING_PORT_ERROR);
  let normalised = url.toString();
  // Keep an explicitly typed default port (ws:80 / wss:443) that URL normalisation dropped, so the result is
  // itself a valid target (parseTarget stays idempotent) and a remembered address round-trips without losing it.
  if (url.port === '') normalised = normalised.replace(/^(wss?:\/\/[^/?#]+)/, `$1:${port}`);
  return { ok: true, url: normalised.replace(/\/$/, ''), scheme, host: url.hostname, loopback: isLoopbackHost(url.hostname) };
}
