import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractError } from '../src/protocol/errors';
import { explainClose, explainOpenFailure } from '../src/transport/notices';
import { TransportError, TransportOpenError, type CloseInfo } from '../src/transport/types';
import { WebSocketTransport } from '../src/transport/websocket';
import { FakeWebSocket } from './helpers/fakeWebSocket';

const Impl = FakeWebSocket as unknown as typeof WebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  FakeWebSocket.throwOnConstruct = null;
  vi.stubGlobal('WebSocket', FakeWebSocket); // the transport compares readyState with WebSocket.OPEN
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function connected(options = {}) {
  const transport = new WebSocketTransport('ws://192.168.1.50:9101', { webSocketImpl: Impl, ...options });
  const messages: unknown[] = [];
  const closes: CloseInfo[] = [];
  transport.setListener({ message: (m) => messages.push(m), closed: (i) => closes.push(i) });
  const opening = transport.open();
  const ws = FakeWebSocket.instances[0];
  return { transport, ws, opening, messages, closes };
}

describe('WebSocketTransport: one JSON text frame per message', () => {
  it('opens, sends compact JSON text and parses nanosecond fields as BigInt', async () => {
    const { transport, ws, opening, messages } = connected();
    ws.open();
    await opening;
    transport.send({ type: 'request', id: 1, op: 'hello', params: { contract_version: '0.1.0' } });
    expect(ws.sent).toEqual(['{"type":"request","id":1,"op":"hello","params":{"contract_version":"0.1.0"}}']);
    ws.receive('{"type":"event","event":"frames","data":{"frames":[{"timestamp_ns":1700000000000000001}]}}');
    expect(messages).toHaveLength(1);
    expect((messages[0] as { data: { frames: { timestamp_ns: bigint }[] } }).data.frames[0].timestamp_ns).toBe(1700000000000000001n);
  });

  it('never sends binary frames and closes on one from the device (code 4000)', async () => {
    const { ws, opening, closes } = connected();
    ws.open();
    await opening;
    ws.receive(new ArrayBuffer(4));
    expect(ws.closeCalls[0].code).toBe(4000);
    await Promise.resolve();
    expect(closes[0]).toMatchObject({ code: 4000, initiatedBy: 'local', phase: 'open' });
  });

  it.each([['invalid JSON', 'not json'], ['a non-object', '[1]'], ['an oversized message', 'x'.repeat(2048)]])('closes on %s', async (_n, payload) => {
    const { ws, opening } = connected({ maxInboundChars: 1024 });
    ws.open();
    await opening;
    ws.receive(payload);
    expect(ws.closeCalls[0].code).toBe(4000);
  });

  it('refuses requests over the 4096-byte contract limit and a backed-up send buffer', async () => {
    const { transport, ws, opening } = connected();
    ws.open();
    await opening;
    expect(() => transport.send({ type: 'request', id: 1, op: 'x', params: { blob: 'a'.repeat(5000) } })).toThrow(TransportError);
    ws.bufferedAmount = 1_000_000;
    expect(() => transport.send({ type: 'request', id: 2, op: 'x', params: {} })).toThrow(/not sent earlier/);
    expect(ws.sent).toHaveLength(0);
  });

  it('send fails with DEVICE_DISCONNECTED when the link is not open', () => {
    const transport = new WebSocketTransport('ws://x', { webSocketImpl: Impl });
    expect(() => transport.send({ type: 'request', id: 1, op: 'x', params: {} })).toThrow(ContractError);
  });
});

describe('WebSocketTransport: failures to open and links that end', () => {
  it('a refused or blocked connection rejects with the browser-reported 1006', async () => {
    const { ws, opening } = connected();
    const caught = opening.catch((e) => e);
    ws.serverClose(1006);
    const error = await caught;
    expect(error).toBeInstanceOf(TransportOpenError);
    expect(error.info).toMatchObject({ phase: 'connecting', code: 1006, wasClean: false });
  });

  it('a constructor error (e.g. a browser that forbids ws:// from https) rejects instead of throwing', async () => {
    FakeWebSocket.throwOnConstruct = Object.assign(new Error('insecure'), { name: 'SecurityError' });
    const transport = new WebSocketTransport('ws://x', { webSocketImpl: Impl });
    await expect(transport.open()).rejects.toMatchObject({ info: { phase: 'connecting', reason: 'SecurityError' } });
  });

  it('waits for the browser permission prompt, then times out with a clear reason', async () => {
    vi.useFakeTimers();
    const { opening } = connected({ openTimeoutMs: 30_000 });
    const caught = opening.catch((e) => e);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(FakeWebSocket.instances[0].closeCalls).toHaveLength(0); // still waiting: the prompt may be open
    await vi.advanceTimersByTimeAsync(2000);
    expect((await caught).info.reason).toBe('timeout');
  });

  it.each([1013, 4001, 1001, 1003, 1009, 1006])('reports an established link ending with code %i', async (code) => {
    const { ws, opening, closes } = connected();
    ws.open();
    await opening;
    ws.serverClose(code, 'why');
    expect(closes).toEqual([{ phase: 'open', code, reason: 'why', wasClean: code !== 1006, initiatedBy: 'remote' }]);
  });

  it('a local close is reported as a normal local close', async () => {
    const { transport, ws, opening, closes } = connected();
    ws.open();
    await opening;
    transport.close();
    await Promise.resolve();
    expect(closes[0]).toMatchObject({ code: 1000, initiatedBy: 'local' });
    expect(ws.closeCalls[0].code).toBe(1000);
  });
});

describe('plain-language notices', () => {
  const info = (code: number | null, over: Partial<CloseInfo> = {}): CloseInfo => ({ phase: 'open', code, reason: '', wasClean: true, initiatedBy: 'remote', ...over });
  const ctx = { pageOrigin: 'https://bridge.plotune.net', targetUrl: 'ws://192.168.1.50:9101', permission: 'unknown' as const };

  it.each([
    [4001, 'replaced', /another window or tool/i],
    [1013, 'overflow', /could not keep up/i],
    [1003, 'rejected-message', /rejected something/i],
    [1009, 'rejected-message', /too large/i],
    [1001, 'device-closed', /ended the connection/i],
    [1006, 'lost', /lost the connection/i],
    [4000, 'protocol', /could not understand/i],
  ])('close code %i is explained as %s in plain words', (code, kind, text) => {
    const n = explainClose(info(code));
    expect(n.kind).toBe(kind);
    expect(`${n.title} ${n.summary}`).toMatch(text);
    expect(`${n.title} ${n.summary} ${n.steps.join(' ')}`).not.toMatch(/\b(1013|4001|1003|1009|1001|1006)\b/); // codes live in technical details only
    expect(n.technical).toContain(`close code: ${code}`);
  });

  it('a replaced session tells the user not to expect an automatic reconnect', () => {
    expect(explainClose(info(4001)).steps.join(' ')).toMatch(/connect again/i);
  });

  it('a user-initiated close is not an error', () => {
    expect(explainClose(info(1000, { initiatedBy: 'local' }))).toMatchObject({ kind: 'ended', severity: 'info' });
  });

  it('a failed open lists causes, names the origin to allow, and mentions wss:// for ws:// targets', () => {
    const n = explainOpenFailure(info(1006, { phase: 'connecting', wasClean: false }), ctx);
    expect(n.kind).toBe('unreachable');
    expect(n.steps.join('\n')).toContain('https://bridge.plotune.net');
    expect(n.steps.join('\n')).toMatch(/wss:\/\//);
    expect(n.steps.join('\n')).toMatch(/Block/);
  });

  it('a known denied permission becomes the headline', () => {
    const n = explainOpenFailure(info(1006, { phase: 'connecting' }), { ...ctx, permission: 'denied' });
    expect(n.kind).toBe('permission-blocked');
    expect(n.title).toMatch(/blocking access to your local network/i);
  });

  it('a granted permission is not offered as a cause, and wss:// targets do not suggest wss://', () => {
    const n = explainOpenFailure(info(1006, { phase: 'connecting' }), { ...ctx, targetUrl: 'wss://192.168.1.50:9443', permission: 'granted' });
    expect(n.steps.join('\n')).not.toMatch(/choose Block|chose Block/i);
    expect(n.steps.join('\n')).not.toMatch(/try that instead/);
  });

  it('a timeout asks the user to answer a pending browser question', () => {
    const n = explainOpenFailure(info(null, { phase: 'connecting', reason: 'timeout' }), ctx);
    expect(n.kind).toBe('timeout');
    expect(n.steps.join(' ')).toMatch(/Allow/);
  });
});
