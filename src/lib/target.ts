export interface ParsedTarget {
  ok: boolean;
  /** Normalised ws:// or wss:// URL; empty when not ok. */
  url: string;
  scheme: 'ws' | 'wss' | null;
  host: string;
  loopback: boolean;
  error?: string;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host.toLowerCase()) || host.toLowerCase().endsWith('.localhost');
}

/** Accepts `host:port`, `ws://host:port` or `wss://host:port`. A bare host gets ws://, the scheme the reference device serves. */
export function parseTarget(input: string): ParsedTarget {
  const text = input.trim();
  const bad = (error: string): ParsedTarget => ({ ok: false, url: '', scheme: null, host: '', loopback: false, error });
  if (!text) return bad('Enter the device address, for example 192.168.1.50:9101.');
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
  return { ok: true, url: url.toString().replace(/\/$/, ''), scheme, host: url.hostname, loopback: isLoopbackHost(url.hostname) };
}
