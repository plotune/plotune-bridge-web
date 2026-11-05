// BR-WEB-006 rev 2 (browser/hosting/device-origin requirements) and BWEB-002 rev 1 (local independence).
// These are the L2 test cases that the requirements sheet has no verification rows for: the declared
// supported-browser matrix, plain guidance for a denied local-network permission, honest explanation of an
// unsupported mixed-content/origin combination, and "unknown is never denied".
import { describe, expect, it } from 'vitest';
import { connectPolicy, detectBrowser, unsupportedNotice } from '../src/lib/browser';
import { queryLocalNetworkPermission } from '../src/lib/permission';
import { isLoopbackHost, parseTarget } from '../src/lib/target';
import { explainOpenFailure, type NoticeContext } from '../src/transport/notices';
import type { CloseInfo } from '../src/transport/types';

const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
};

const close = (over: Partial<CloseInfo> = {}): CloseInfo => ({ phase: 'connecting', code: 1006, reason: '', wasClean: false, initiatedBy: 'remote', ...over });
const context = (over: Partial<NoticeContext> = {}): NoticeContext => ({ pageOrigin: 'https://bridge.plotune.net', targetUrl: 'ws://192.168.1.50:9101', permission: 'unknown', ...over });

describe('BR-WEB-006 r2: the declared supported-browser matrix is enforced (connect policy)', () => {
  const b = (ua: string) => detectBrowser({ userAgent: ua });
  const p = (key: keyof typeof UA, address: string, secure: boolean) => connectPolicy(b(UA[key]), parseTarget(address), secure);

  it('the reference browser is desktop Chromium (Windows 11 x64)', () => {
    expect(b(UA.chrome)).toMatchObject({ family: 'chromium', name: 'Chrome', supported: true });
  });

  it.each([
    ['chrome', 'wss://192.168.1.50:9443', true, true],
    ['chrome', 'ws://127.0.0.1:9101', true, true],
    ['chrome', 'ws://localhost:9101', true, true],
    ['chrome', 'ws://192.168.1.50:9101', false, true],
    ['firefox', 'ws://192.168.1.50:9101', true, false],
    ['firefox', 'ws://localhost:9101', true, true],
    ['firefox', 'ws://127.0.0.1:9101', true, true],
    ['firefox', 'wss://192.168.1.50:9443', true, true],
    ['firefox', 'ws://192.168.1.50:9101', false, true],
    ['safari', 'ws://192.168.1.50:9101', true, false],
    ['safari', 'wss://192.168.1.50:9443', true, true],
  ] as const)('%s %s (secure page %s) -> allowed %s', (ua, address, secure, allowed) => {
    expect(p(ua, address, secure).allowed).toBe(allowed);
  });

  it('an unsupported browser on a secure page gets a plain reason, not a device accusation', () => {
    const policy = p('firefox', 'ws://192.168.1.50:9101', true);
    expect(policy.allowed).toBe(false);
    expect(policy.reason).toMatch(/Firefox blocks plain ws:\/\/ connections from secure pages/);
    expect(policy.reason).toMatch(/wss:\/\//);
    expect(policy.reason).not.toMatch(/device is (offline|unreachable|powered)/i);
  });

  it('an invalid address is rejected with its own message', () => {
    const policy = p('chrome', 'http://192.168.1.50:9101', true);
    expect(policy).toEqual({ allowed: false, reason: 'Use a ws:// or wss:// address.' });
  });

  it('the unsupported-browser notice does not claim more than was tested', () => {
    const n = unsupportedNotice(b(UA.firefox));
    expect(n.title).toMatch(/not supported for direct device connection yet/);
    expect(n.steps.join(' ')).toMatch(/Chrome, Edge or Brave/);
    expect(n.steps.join(' ')).toMatch(/has not been tested/);
  });
});

describe('BR-WEB-006 r2: denied local permission and unsupported mixed-content/origin combinations are explained plainly', () => {
  it('a browser-refused ws:// from a secure HTTPS page is named as a browser rule, never as a device fault', () => {
    // WebSocketTransport.open() surfaces the constructor's DOMException name as reason: 'SecurityError'.
    const n = explainOpenFailure(close({ reason: 'SecurityError', code: null, initiatedBy: 'local' }), context());
    expect(n.kind).toBe('mixed-content');
    expect(n.severity).toBe('error');
    expect(`${n.title} ${n.summary}`).toMatch(/secure page|HTTPS/);
    expect(n.summary).toMatch(/not a problem with your device/i);
    expect(n.steps.join(' ')).toMatch(/wss:\/\//);
    expect(n.steps.join(' ')).toMatch(/127\.0\.0\.1:4173/);
    // No false cause: no device blame and no claim that the browser revealed an unknown cause.
    expect(`${n.title} ${n.summary} ${n.steps.join(' ')}`).not.toMatch(/Couldn't connect to the device|device is powered|device did not answer/);
    expect(n.technical).toContain('SecurityError');
  });

  it('a denied local-network permission is the headline even when the open also timed out', () => {
    const n = explainOpenFailure(close({ reason: 'timeout', code: null }), context({ permission: 'denied' }));
    expect(n.kind).toBe('permission-blocked');
    expect(n.title).toMatch(/blocking access to your local network/i);
    expect(n.steps.join(' ')).toMatch(/site settings/);
    expect(n.steps.join(' ')).toMatch(/Allow/);
  });

  it('a generic failed open lists causes, names the origin to allow, and never claims the browser revealed the cause', () => {
    const n = explainOpenFailure(close(), context());
    expect(n.kind).toBe('unreachable');
    expect(n.summary).toMatch(/browser does not say why/i);
    expect(n.steps.join(' ')).toContain('https://bridge.plotune.net');
    expect(n.steps.join(' ')).toMatch(/wss:\/\//);
    expect(n.technical).toContain('close code: 1006');
  });
});

describe('BR-WEB-006 r2: the local-network permission is best-effort; unknown is never denied', () => {
  const permissions = (map: Record<string, string>) => ({
    query: async ({ name }: { name: string }) => {
      if (!(name in map)) throw new TypeError('unknown permission');
      return { state: map[name] };
    },
  });

  it('reads granted, prompt and denied when the browser exposes the permission', async () => {
    expect(await queryLocalNetworkPermission(false, permissions({ 'local-network': 'granted' }))).toBe('granted');
    expect(await queryLocalNetworkPermission(false, permissions({ 'local-network-access': 'prompt' }))).toBe('prompt');
    expect(await queryLocalNetworkPermission(false, permissions({ 'local-network-access': 'denied' }))).toBe('denied');
    expect(await queryLocalNetworkPermission(true, permissions({ 'loopback-network': 'denied' }))).toBe('denied');
  });

  it('a browser that exposes no permission name is unknown, not denied', async () => {
    expect(await queryLocalNetworkPermission(false, permissions({}))).toBe('unknown');
    expect(await queryLocalNetworkPermission(false, undefined)).toBe('unknown');
  });
});

describe('BR-WEB-006 r2: device-origin / address rules', () => {
  it('loopback endpoints are identified for the secure-page exemption', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', 'device.localhost']) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ['192.168.1.50', '192.0.2.1', 'bridge.local']) expect(isLoopbackHost(host)).toBe(false);
  });

  it('only ws:// and wss:// addresses are accepted, and loopback is flagged', () => {
    expect(parseTarget('192.168.1.50:9101')).toMatchObject({ ok: true, scheme: 'ws', loopback: false, url: 'ws://192.168.1.50:9101' });
    expect(parseTarget('wss://192.168.1.50:9443')).toMatchObject({ ok: true, scheme: 'wss', loopback: false });
    expect(parseTarget('ws://127.0.0.1:9101')).toMatchObject({ ok: true, scheme: 'ws', loopback: true });
    expect(parseTarget('http://192.168.1.50:9101').ok).toBe(false);
  });
});
