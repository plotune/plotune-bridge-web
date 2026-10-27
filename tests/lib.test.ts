import { describe, expect, it } from 'vitest';
import { connectPolicy, detectBrowser, unsupportedNotice } from '../src/lib/browser';
import { bytesToHex, formatId, parseHexBytes, parseHexNumber } from '../src/lib/bytes';
import { queryLocalNetworkPermission } from '../src/lib/permission';
import { parseTarget } from '../src/lib/target';
import type { CanFrame } from '../src/protocol/types';
import { TraceBuffer } from '../src/state/trace';

const UA = {
  chrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0 Mobile/15E148 Safari/604.1',
  iosFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/157.0 Mobile/15E148 Safari/605.1.15',
  odd: 'SomeCrawler/1.0',
};

describe('browser detection', () => {
  it('Chrome, Edge and Brave are Chromium and supported', () => {
    expect(detectBrowser({ userAgent: UA.chrome })).toEqual({ family: 'chromium', name: 'Chrome', supported: true });
    expect(detectBrowser({ userAgent: UA.edge })).toMatchObject({ family: 'chromium', name: 'Edge', supported: true });
    // Brave presents a Chrome user agent and says who it is through the UA client hints.
    expect(detectBrowser({ userAgent: UA.chrome, userAgentData: { brands: [{ brand: 'Brave', version: '156' }, { brand: 'Chromium', version: '156' }] } })).toMatchObject({ name: 'Brave', supported: true });
  });
  it('Firefox and Safari are not supported for direct connection', () => {
    expect(detectBrowser({ userAgent: UA.firefox })).toEqual({ family: 'firefox', name: 'Firefox', supported: false });
    expect(detectBrowser({ userAgent: UA.safari })).toEqual({ family: 'webkit', name: 'Safari', supported: false });
  });
  it('every browser on iOS is WebKit, whatever its name', () => {
    expect(detectBrowser({ userAgent: UA.iosChrome })).toMatchObject({ family: 'webkit', name: 'Chrome on iOS', supported: false });
    expect(detectBrowser({ userAgent: UA.iosFirefox })).toMatchObject({ family: 'webkit', supported: false });
  });
  it('an unrecognised browser is not claimed as supported', () => {
    expect(detectBrowser({ userAgent: UA.odd })).toMatchObject({ family: 'unknown', supported: false });
  });
  it('the notice is honest about scope', () => {
    const n = unsupportedNotice(detectBrowser({ userAgent: UA.firefox }));
    expect(n.title).toMatch(/not supported for direct device connection yet/);
    expect(n.steps.join(' ')).toMatch(/Chrome, Edge or Brave/);
    expect(n.steps.join(' ')).toMatch(/not been tested/);
  });
});

describe('connect policy (from the BR-CAN-O-014 reachability spike)', () => {
  const t = (s: string) => parseTarget(s);
  const b = (ua: string) => detectBrowser({ userAgent: ua });
  it.each([
    // browser, target, secure page, allowed
    ['chrome', 'ws://192.168.1.50:9101', true, true],
    ['chrome', 'wss://192.168.1.50:9443', true, true],
    ['edge', 'ws://device.local:9101', true, true],
    ['firefox', 'ws://192.168.1.50:9101', true, false],
    ['firefox', 'ws://device.local:9101', true, false],
    ['firefox', 'ws://localhost:9101', true, true],
    ['firefox', 'ws://127.0.0.1:9101', true, true],
    ['firefox', 'wss://192.168.1.50:9443', true, true],
    ['safari', 'ws://localhost:9101', true, false],
    ['safari', 'ws://192.168.1.50:9101', true, false],
    ['safari', 'wss://192.168.1.50:9443', true, true],
    ['iosChrome', 'ws://192.168.1.50:9101', true, false],
    ['firefox', 'ws://192.168.1.50:9101', false, true], // a local http dev page is not a secure context
  ] as const)('%s %s (secure page: %s) -> allowed %s', (browser, target, secure, allowed) => {
    expect(connectPolicy(b(UA[browser]), t(target), secure).allowed).toBe(allowed);
  });
  it('an invalid target is never allowed and carries its message', () => {
    const p = connectPolicy(b(UA.chrome), t('http://x'), true);
    expect(p).toEqual({ allowed: false, reason: 'Use a ws:// or wss:// address.' });
  });
});

describe('device address parsing', () => {
  it.each([
    ['192.168.1.50:9101', 'ws://192.168.1.50:9101', 'ws', false],
    ['ws://bridge.local:9101', 'ws://bridge.local:9101', 'ws', false],
    ['  wss://192.168.1.50:9443/  ', 'wss://192.168.1.50:9443', 'wss', false],
    ['localhost:9101', 'ws://localhost:9101', 'ws', true],
    ['ws://[::1]:9101', 'ws://[::1]:9101', 'ws', true],
    ['ws://127.0.0.1:9101', 'ws://127.0.0.1:9101', 'ws', true],
  ])('%s', (input, url, scheme, loopback) => {
    expect(parseTarget(input)).toMatchObject({ ok: true, url, scheme, loopback });
  });
  it.each(['', '   ', 'http://x', 'ftp://x', 'ws://', 'ws://user:pw@host:1', 'not a url ::'])('rejects %j', (input) => {
    const p = parseTarget(input);
    expect(p.ok).toBe(false);
    expect(p.error).toBeTruthy();
  });
});

describe('local-network permission query', () => {
  const permissions = (map: Record<string, string>) => ({
    query: async ({ name }: { name: string }) => {
      if (!(name in map)) throw new TypeError('unknown permission');
      return { state: map[name] };
    },
  });
  it('reads the state when the browser exposes it', async () => {
    expect(await queryLocalNetworkPermission(false, permissions({ 'local-network': 'denied' }))).toBe('denied');
    expect(await queryLocalNetworkPermission(false, permissions({ 'local-network-access': 'granted' }))).toBe('granted');
    expect(await queryLocalNetworkPermission(false, permissions({ 'local-network': 'prompt' }))).toBe('prompt');
    expect(await queryLocalNetworkPermission(true, permissions({ 'loopback-network': 'denied' }))).toBe('denied');
  });
  it('any failure means unknown, never denied', async () => {
    expect(await queryLocalNetworkPermission(false, permissions({}))).toBe('unknown');
    expect(await queryLocalNetworkPermission(false, undefined)).toBe('unknown');
  });
});

describe('byte helpers', () => {
  it('parses user-entered hex leniently and rejects the rest', () => {
    expect(Array.from(parseHexBytes('0x01, 02:0A-ff')!)).toEqual([1, 2, 10, 255]);
    expect(parseHexBytes('abc')).toBeNull();
    expect(parseHexBytes('zz')).toBeNull();
    expect(parseHexBytes('')).toEqual(new Uint8Array());
  });
  it('parses ids and formats them to their width', () => {
    expect(parseHexNumber('0x7DF')).toBe(0x7df);
    expect(parseHexNumber('xyz')).toBeNull();
    expect(parseHexNumber('123456789')).toBeNull();
    expect(formatId(0x7, false)).toBe('007');
    expect(formatId(0x18daf110, true)).toBe('18DAF110');
    expect(bytesToHex(Uint8Array.of(1, 0xab), ' ')).toBe('01 ab');
  });
});

describe('trace buffer', () => {
  const frame = (n: number): { kind: 'frame'; frame: CanFrame } => ({
    kind: 'frame',
    frame: { channel: (n % 2) + 1, id: n, extended: false, rtr: false, dlc: 0, data: new Uint8Array(), timestampNs: BigInt(n) + 2n ** 60n, direction: 'rx' },
  });
  it('is bounded, counts what leaves the view, and never reorders or relabels what stays', () => {
    const buffer = new TraceBuffer(100);
    for (let i = 0; i < 1000; i += 1) buffer.push(frame(i));
    expect(buffer.length).toBeLessThanOrEqual(100 + 64);
    expect(buffer.evicted + buffer.length).toBe(1000);
    const last = buffer.at(buffer.length - 1);
    expect(last.kind === 'frame' && last.frame.id).toBe(999);
    const first = buffer.at(0);
    expect(first.kind === 'frame' && first.frame.id).toBe(buffer.evicted);
  });
  it('takes the time origin from the first frame and resets on clear', () => {
    const buffer = new TraceBuffer();
    buffer.push({ kind: 'session', text: 'hi' });
    expect(buffer.originNs).toBeNull();
    buffer.push(frame(5));
    expect(buffer.originNs).toBe(5n + 2n ** 60n);
    buffer.clear();
    expect(buffer).toMatchObject({ length: 0, originNs: null, evicted: 0 });
  });
});
