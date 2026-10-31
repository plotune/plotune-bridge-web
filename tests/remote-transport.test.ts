import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractError } from '../src/protocol/errors';
import type { WireObject } from '../src/protocol/wire';
import { transportFactoryFor } from '../src/transport/factory';
import { isRemoteTarget, parseRemoteTarget, RemoteTransport, type RemoteCredentials, type RemoteTransportOptions } from '../src/transport/remote';
import { TransportError, TransportOpenError, type CloseInfo } from '../src/transport/types';

const TICKET = 'TICKET-SECRET-7f3a';
const RELAY = 'wss://relay.test/v1/bridge/signal';
const TARGET = 'remote:proj-1/dev-1';
const CREDS: RemoteCredentials = { ticket: TICKET, iceServers: [{ urls: 'stun:stun.test:3478' }] };
const REGISTER = '{"type":"register","version":"0.1.0-draft","role":"browser","device_id":"dev-1","ticket":"TICKET-SECRET-7f3a"}';
const CANDIDATE_A = 'candidate:1 1 udp 2122260223 192.0.2.10 50000 typ host';
const CANDIDATE_B = 'candidate:2 1 udp 2122194687 198.51.100.7 51000 typ srflx';

// -- hand-written fakes -------------------------------------------------------------------------------------------

/** The relay socket: records sent frames and lets the test deliver frames or close codes. */
class FakeRelaySocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeRelaySocket[] = [];
  static throwOnConstruct: Error | null = null;

  readyState = 0;
  readonly sent: string[] = [];
  readonly closeCalls: { code?: number; reason?: string }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    if (FakeRelaySocket.throwOnConstruct) throw FakeRelaySocket.throwOnConstruct;
    FakeRelaySocket.instances.push(this);
  }
  send(text: string): void {
    this.sent.push(text);
  }
  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    if (this.readyState === FakeRelaySocket.CLOSED) return;
    this.readyState = FakeRelaySocket.CLOSED;
  }
  // -- test controls --
  open(): void {
    this.readyState = FakeRelaySocket.OPEN;
    this.onopen?.();
  }
  receive(message: object | string): void {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
  serverClose(code: number, wasClean = code !== 1006): void {
    this.readyState = FakeRelaySocket.CLOSED;
    this.onclose?.({ code, reason: '', wasClean });
  }
}

class FakeDataChannel {
  readyState = 'connecting';
  bufferedAmount = 0;
  readonly sent: string[] = [];
  closeCount = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(readonly label: string, readonly init: RTCDataChannelInit | undefined) {}
  send(text: string): void {
    this.sent.push(text);
  }
  close(): void {
    this.closeCount++;
    this.readyState = 'closed';
  }
  // -- test controls --
  open(): void {
    this.readyState = 'open';
    this.onopen?.();
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
  remoteClose(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  static failRemoteDescription = false;
  connectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  readonly remoteCandidates: RTCIceCandidateInit[] = [];
  readonly channels: FakeDataChannel[] = [];
  closed = false;
  onicecandidate: ((e: { candidate: RTCIceCandidateInit & { candidate: string } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor(readonly config: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }
  createDataChannel(label: string, init?: RTCDataChannelInit): FakeDataChannel {
    const channel = new FakeDataChannel(label, init);
    this.channels.push(channel);
    return channel;
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'v=0 offer-sdp' };
  }
  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description;
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (FakePeerConnection.failRemoteDescription) throw new Error('bad answer');
    this.remoteDescription = description;
  }
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.remoteCandidates.push(candidate);
  }
  close(): void {
    this.closed = true;
  }
  // -- test controls --
  gather(candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null): void {
    this.onicecandidate?.({ candidate: candidate as never });
  }
  setState(state: string): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
  get channel(): FakeDataChannel {
    return this.channels[0];
  }
}

// -- helpers ------------------------------------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  FakeRelaySocket.instances = [];
  FakeRelaySocket.throwOnConstruct = null;
  FakePeerConnection.instances = [];
  FakePeerConnection.failRemoteDescription = false;
});
afterEach(() => {
  vi.useRealTimers();
});

/** Lets pending promises and paced signaling timers run. */
async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function setup(overrides: Partial<RemoteTransportOptions> = {}) {
  const getCredentials = vi.fn(async () => CREDS);
  const transport = new RemoteTransport(TARGET, {
    getCredentials,
    relayUrl: RELAY,
    webSocketImpl: FakeRelaySocket as unknown as typeof WebSocket,
    peerConnectionImpl: FakePeerConnection as unknown as typeof RTCPeerConnection,
    signalIntervalMs: 100,
    ...overrides,
  });
  const messages: WireObject[] = [];
  const closes: CloseInfo[] = [];
  transport.setListener({ message: (m) => messages.push(m), closed: (i) => closes.push(i) });
  const outcome: { resolved: boolean; error: unknown } = { resolved: false, error: undefined };
  const opening = transport.open().then(
    () => {
      outcome.resolved = true;
    },
    (error: unknown) => {
      outcome.error = error;
    },
  );
  await tick();
  return { transport, getCredentials, messages, closes, opening, outcome, relay: FakeRelaySocket.instances[FakeRelaySocket.instances.length - 1] };
}

/** Drives the relay handshake until the browser has sent its offer. */
async function negotiate(overrides: Partial<RemoteTransportOptions> = {}) {
  const env = await setup(overrides);
  env.relay.open();
  env.relay.receive({ type: 'registered', peer_id: 'browser-1', role: 'browser', device_id: 'dev-1' });
  env.relay.receive({ type: 'peer', role: 'device', state: 'connected', peer_id: 'dev-1' });
  await tick(150);
  const pc = FakePeerConnection.instances[0];
  return { ...env, pc, channel: pc.channel };
}

async function openLink(overrides: Partial<RemoteTransportOptions> = {}) {
  const env = await negotiate(overrides);
  env.relay.receive({ type: 'answer', sdp: 'v=0 answer-sdp', sdp_type: 'answer', from: 'dev-1', to: 'browser-1' });
  await tick();
  env.channel.open();
  await tick();
  return env;
}

// -- target parsing -----------------------------------------------------------------------------------------------

describe('remote targets', () => {
  it('parses remote:<projectId>/<deviceUuid> and rejects anything else', () => {
    expect(parseRemoteTarget('remote:proj-1/3f2a-9c')).toEqual({ projectId: 'proj-1', deviceUuid: '3f2a-9c' });
    for (const bad of ['remote:', 'remote:proj', 'remote:/dev', 'remote:proj/', 'remote:a/b/c', 'remote:../x', 'remote:p/d.e', 'ws://192.168.1.5:9101', '']) {
      expect(parseRemoteTarget(bad)).toBeNull();
    }
  });

  it('isRemoteTarget is a prefix check, so malformed remote targets still route to the remote adapter', () => {
    expect(isRemoteTarget('remote:anything')).toBe(true);
    expect(isRemoteTarget('ws://192.168.1.5:9101')).toBe(false);
  });

  it('transportFactoryFor routes by prefix and rejects malformed remote targets', () => {
    const webSocket = vi.fn(() => ({ kind: 'websocket' }) as never);
    const remote = vi.fn(() => ({ kind: 'webrtc-relay' }) as never);
    const factory = transportFactoryFor({ webSocket, remote });
    factory('ws://192.168.1.5:9101');
    expect(webSocket).toHaveBeenCalledWith('ws://192.168.1.5:9101');
    factory('remote:proj-1/dev-1');
    expect(remote).toHaveBeenCalledWith('proj-1', 'dev-1');
    expect(() => factory('remote:bad/target/here')).toThrow(TypeError);
  });
});

// -- happy path ---------------------------------------------------------------------------------------------------

describe('RemoteTransport: signaling and the data channel', () => {
  it('sends the registration first, with the exact shape and no query string on the relay URL', async () => {
    const { relay } = await negotiate();
    expect(relay.url).toBe(RELAY);
    expect(relay.url).not.toContain('?');
    expect(relay.sent[0]).toBe(REGISTER);
    expect(JSON.parse(relay.sent[0])).toEqual({ type: 'register', version: '0.1.0-draft', role: 'browser', device_id: 'dev-1', ticket: TICKET });
  });

  it('creates the offer on the peer connection with the ICE servers and an ordered "contract" channel, then sends it', async () => {
    const { pc, relay, channel } = await negotiate();
    expect(pc.config.iceServers).toEqual(CREDS.iceServers);
    expect(channel.label).toBe('contract');
    expect(channel.init).toEqual({ ordered: true });
    expect(relay.sent[1]).toBe('{"type":"offer","sdp":"v=0 offer-sdp","sdp_type":"offer"}');
    expect(pc.localDescription).toEqual({ type: 'offer', sdp: 'v=0 offer-sdp' });
  });

  it('applies the answer, exchanges candidates both ways, and opens the channel', async () => {
    const { transport, relay, pc, channel, opening, outcome, closes } = await negotiate();
    // Local candidates gathered after the offer are sent; the end-of-candidates marker is not.
    pc.gather({ candidate: CANDIDATE_A, sdpMid: '0', sdpMLineIndex: 0 });
    pc.gather(null);
    await tick(150);
    expect(relay.sent).toContain(`{"type":"candidate","candidate":"${CANDIDATE_A}","sdp_mid":"0","sdp_m_line_index":0}`);
    expect(relay.sent.filter((s) => s.includes('"candidate"'))).toHaveLength(1);

    relay.receive({ type: 'answer', sdp: 'v=0 answer-sdp', sdp_type: 'answer', from: 'dev-1', to: 'browser-1' });
    await tick();
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer-sdp' });

    relay.receive({ type: 'candidate', candidate: CANDIDATE_B, sdp_mid: '0', sdp_m_line_index: 0, from: 'dev-1', to: 'browser-1' });
    await tick();
    expect(pc.remoteCandidates).toEqual([{ candidate: CANDIDATE_B, sdpMid: '0', sdpMLineIndex: 0 }]);

    channel.open();
    await opening;
    expect(outcome.resolved).toBe(true);
    expect(transport.kind).toBe('webrtc-relay');
    expect(transport.target).toBe(TARGET);
    expect(closes).toEqual([]);
  });

  it('keeps the signaling socket open while the link is up, so the device is never sent a relay bye', async () => {
    const { relay, channel, opening, transport } = await negotiate();
    relay.receive({ type: 'answer', sdp: 'v=0 answer-sdp', sdp_type: 'answer' });
    await tick();
    channel.open();
    await opening;
    expect(relay.closeCalls).toEqual([]);
    transport.close();
    expect(relay.closeCalls).toEqual([{ code: 1000, reason: 'client closing' }]);
  });

  it('carries one contract message per data-channel text message in both directions', async () => {
    const { transport, channel, messages } = await openLink();
    channel.receive('{"type":"event","event":"frames","data":{"frames":[{"timestamp_ns":1700000000000000001}]}}');
    expect(messages).toHaveLength(1);
    expect((messages[0] as { data: { frames: { timestamp_ns: bigint }[] } }).data.frames[0].timestamp_ns).toBe(1700000000000000001n);
    transport.send({ type: 'request', id: 1, op: 'hello', params: { contract_version: '0.1.0' } });
    expect(channel.sent).toEqual(['{"type":"request","id":1,"op":"hello","params":{"contract_version":"0.1.0"}}']);
  });

  it('paces signaling so no more than one message leaves per interval', async () => {
    const { pc, relay } = await negotiate();
    // The register and offer are already out; five candidates are queued behind them.
    for (const port of [1, 2, 3, 4, 5]) pc.gather({ candidate: `candidate:${port} 1 udp 1 192.0.2.1 ${port} typ host`, sdpMid: '0', sdpMLineIndex: 0 });
    // The offer left at 100 ms, so the next slot opens at 200 ms, then 300 ms.
    const before = relay.sent.length;
    await tick(40);
    expect(relay.sent.length).toBe(before);
    await tick(20);
    expect(relay.sent.length).toBe(before + 1);
    await tick(100);
    expect(relay.sent.length).toBe(before + 2);
  });

  it('sends the register and offer as soon as the device is seen, even when peer arrives before registered', async () => {
    const env = await setup();
    env.relay.open();
    env.relay.receive({ type: 'peer', role: 'device', state: 'connected', peer_id: 'dev-1' });
    env.relay.receive({ type: 'registered', peer_id: 'browser-1', role: 'browser', device_id: 'dev-1' });
    await tick(150);
    expect(env.relay.sent[1]).toMatch(/^\{"type":"offer"/);
    expect(FakePeerConnection.instances).toHaveLength(1);
  });

  it('tolerates a duplicate peer event: only one offer is made', async () => {
    const { relay, pc } = await negotiate();
    relay.receive({ type: 'peer', role: 'device', state: 'connected', peer_id: 'dev-1' });
    await tick(500);
    expect(relay.sent.filter((s) => s.startsWith('{"type":"offer"'))).toHaveLength(1);
    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(pc.channels).toHaveLength(1);
  });

  it('ignores the relay routing fields and unknown message types', async () => {
    const { relay, opening } = await negotiate();
    relay.receive({ type: 'unknown', whatever: 1 });
    relay.receive({ type: 'answer', sdp: 'v=0 answer-sdp', sdp_type: 'answer', from: 'dev-1', to: 'browser-1', extra: true });
    await tick();
    FakePeerConnection.instances[0].channel.open();
    await opening;
  });

  it('queues remote candidates that arrive before the answer and applies them afterwards in order', async () => {
    const { relay, pc, channel, opening } = await negotiate();
    relay.receive({ type: 'candidate', candidate: CANDIDATE_A, sdp_mid: '0', sdp_m_line_index: 0 });
    relay.receive({ type: 'candidate', candidate: CANDIDATE_B, sdp_mid: null, sdp_m_line_index: null });
    await tick();
    expect(pc.remoteCandidates).toEqual([]);
    relay.receive({ type: 'answer', sdp: 'v=0 answer-sdp', sdp_type: 'answer' });
    await tick();
    expect(pc.remoteCandidates).toEqual([
      { candidate: CANDIDATE_A, sdpMid: '0', sdpMLineIndex: 0 },
      { candidate: CANDIDATE_B, sdpMid: null, sdpMLineIndex: null },
    ]);
    channel.open();
    await opening;
  });

  it('does not let a refused remote candidate stop the connection', async () => {
    const { relay, pc, channel, opening } = await negotiate();
    pc.addIceCandidate = () => Promise.reject(new Error('stale'));
    relay.receive({ type: 'answer', sdp: 'v=0 answer-sdp', sdp_type: 'answer' });
    await tick();
    relay.receive({ type: 'candidate', candidate: CANDIDATE_A, sdp_mid: '0', sdp_m_line_index: 0 });
    await tick();
    channel.open();
    await opening;
  });
});

// -- relay close codes, errors and timeouts -----------------------------------------------------------------------

describe('RemoteTransport: failures to open', () => {
  it.each([
    [4003, 'ticket rejected or expired'],
    [4008, 'relay is busy'],
    [4001, 'replaced by another browser session'],
    [1006, 'could not reach the relay'],
    [1011, 'relay closed the connection'],
  ])('relay close code %i rejects open with the reason "%s"', async (code, reason) => {
    const { relay, opening, outcome } = await setup();
    relay.serverClose(code);
    await opening;
    expect(outcome.error).toBeInstanceOf(TransportOpenError);
    expect((outcome.error as TransportOpenError).info).toEqual({ phase: 'connecting', code, reason, wasClean: code !== 1006, initiatedBy: 'remote' });
  });

  it('a relay close after registration but before the channel opens also rejects open', async () => {
    const { relay, opening, outcome } = await negotiate();
    relay.serverClose(4008);
    await opening;
    expect((outcome.error as TransportOpenError).info).toMatchObject({ phase: 'connecting', reason: 'relay is busy' });
  });

  it('a device that is not online (PEER_NOT_FOUND) rejects open', async () => {
    const { relay, opening, outcome } = await setup();
    relay.open();
    relay.receive({ type: 'registered', peer_id: 'browser-1', role: 'browser', device_id: 'dev-1' });
    relay.receive({ type: 'error', code: 'PEER_NOT_FOUND' });
    await opening;
    expect((outcome.error as TransportOpenError).info).toMatchObject({ phase: 'connecting', reason: 'device is not online', initiatedBy: 'remote' });
  });

  it('a device that never joins the room times out as "device is not online", not as a generic timeout', async () => {
    const { relay, opening, outcome } = await setup({ openTimeoutMs: 30_000 });
    relay.open();
    relay.receive({ type: 'registered', peer_id: 'browser-1', role: 'browser', device_id: 'dev-1' });
    await tick(29_000);
    expect(outcome.error).toBeUndefined();
    await tick(2_000);
    await opening;
    expect((outcome.error as TransportOpenError).info).toMatchObject({ phase: 'connecting', reason: 'device is not online', initiatedBy: 'local' });
    expect(relay.closeCalls).toHaveLength(1);
  });

  it('times out with the reason "timeout" when the relay never answers', async () => {
    const { relay, opening, outcome } = await setup({ openTimeoutMs: 30_000 });
    relay.open();
    await tick(30_000);
    await opening;
    expect((outcome.error as TransportOpenError).info).toMatchObject({ phase: 'connecting', code: null, reason: 'timeout', initiatedBy: 'local' });
  });

  it('a bye from the device before open rejects open', async () => {
    const { relay, opening, outcome } = await negotiate();
    relay.receive({ type: 'bye', from: 'dev-1', to: 'browser-1', reason: 'peer_disconnected' });
    await opening;
    expect((outcome.error as TransportOpenError).info).toMatchObject({ phase: 'connecting', reason: 'device disconnected' });
  });

  it('a failed peer connection before open rejects open', async () => {
    const { pc, opening, outcome } = await negotiate();
    pc.setState('failed');
    await opening;
    expect((outcome.error as TransportOpenError).info).toMatchObject({ phase: 'connecting', reason: 'peer connection failed' });
  });

  it('an answer the browser cannot apply rejects open', async () => {
    FakePeerConnection.failRemoteDescription = true;
    const { relay, opening, outcome } = await negotiate();
    relay.receive({ type: 'answer', sdp: 'v=0 bad', sdp_type: 'answer' });
    await tick();
    await opening;
    expect((outcome.error as TransportOpenError).info).toMatchObject({ phase: 'connecting', reason: 'answer rejected' });
  });

  it('a data channel that closes before it opens rejects open', async () => {
    const { relay, channel, opening, outcome } = await negotiate();
    relay.receive({ type: 'answer', sdp: 'v=0 answer-sdp', sdp_type: 'answer' });
    await tick();
    channel.remoteClose();
    await opening;
    expect((outcome.error as TransportOpenError).info).toMatchObject({ phase: 'connecting', reason: 'data channel closed' });
  });

  it('a relay that delivers invalid JSON before open is a failed open, not a crash', async () => {
    const { relay, opening, outcome } = await setup();
    relay.open();
    relay.receive('not json');
    await opening;
    expect(outcome.error).toBeInstanceOf(TransportOpenError);
    expect(relay.closeCalls).toHaveLength(1);
  });

  it('rejects when the credentials cannot be fetched, without exposing the caller error', async () => {
    const env = await setup({ getCredentials: async () => Promise.reject(new Error(`leaked ${TICKET}`)) });
    await env.opening;
    const error = env.outcome.error as TransportOpenError;
    expect(error).toBeInstanceOf(TransportOpenError);
    expect(error.info).toMatchObject({ phase: 'connecting', reason: 'credentials unavailable' });
    expect(FakeRelaySocket.instances).toHaveLength(0);
  });

  it('rejects an invalid target without connecting', async () => {
    const transport = new RemoteTransport('remote:bad/target/x', {
      getCredentials: vi.fn(async () => CREDS),
      webSocketImpl: FakeRelaySocket as unknown as typeof WebSocket,
    });
    await expect(transport.open()).rejects.toMatchObject({ info: { reason: 'invalid target' } });
    expect(FakeRelaySocket.instances).toHaveLength(0);
  });

  it.each(['ws://relay.test/signal', 'wss://relay.test/signal?x=1'])('refuses the relay address %s (must be wss:// with no query string)', async (relayUrl) => {
    const env = await setup({ relayUrl });
    await env.opening;
    expect((env.outcome.error as TransportOpenError).info).toMatchObject({ reason: 'invalid relay address' });
    expect(FakeRelaySocket.instances).toHaveLength(0);
  });

  it('a relay socket that cannot be constructed rejects open', async () => {
    FakeRelaySocket.throwOnConstruct = Object.assign(new Error('blocked'), { name: 'SecurityError' });
    const { opening, outcome } = await setup();
    await opening;
    expect((outcome.error as TransportOpenError).info).toMatchObject({ phase: 'connecting', reason: 'SecurityError' });
  });

  it('an open() call on a link that already ended rejects without reconnecting', async () => {
    const env = await setup();
    env.transport.close();
    await env.opening;
    await expect(env.transport.open()).rejects.toBeInstanceOf(TransportOpenError);
    expect(FakeRelaySocket.instances).toHaveLength(1);
  });
});

// -- established links --------------------------------------------------------------------------------------------

describe('RemoteTransport: an open link', () => {
  it('reports a remote channel close after open as a remote close', async () => {
    const { channel, closes } = await openLink();
    channel.remoteClose();
    expect(closes).toEqual([{ phase: 'open', code: null, reason: 'data channel closed', wasClean: false, initiatedBy: 'remote' }]);
  });

  it('reports a failed peer connection after open as a remote close', async () => {
    const { pc, closes } = await openLink();
    pc.setState('failed');
    expect(closes).toEqual([{ phase: 'open', code: null, reason: 'peer connection failed', wasClean: false, initiatedBy: 'remote' }]);
  });

  it('a binary frame from the device closes the link with code 4000 (same as WebSocketTransport)', async () => {
    const { channel, closes } = await openLink();
    channel.receive(new ArrayBuffer(4));
    expect(closes).toEqual([{ phase: 'open', code: 4000, reason: 'binary frame', wasClean: true, initiatedBy: 'local' }]);
    expect(channel.closeCount).toBe(1);
  });

  it.each([['invalid JSON', 'not json'], ['a non-object', '[1]']])('closes with 4000 on %s', async (_name, payload) => {
    const { channel, closes } = await openLink();
    channel.receive(payload);
    expect(closes[0]).toMatchObject({ code: 4000, initiatedBy: 'local', phase: 'open' });
  });

  it('closes with 4000 on an inbound message over the size limit', async () => {
    const { channel, closes } = await openLink({ maxInboundChars: 1024 });
    channel.receive('x'.repeat(2048));
    expect(closes[0]).toMatchObject({ code: 4000, initiatedBy: 'local', phase: 'open', reason: 'message too large' });
  });

  it('a relay bye after the channel opened does not affect the link', async () => {
    const { relay, channel, closes, messages } = await openLink();
    relay.receive({ type: 'bye', from: 'dev-1', to: 'browser-1', reason: 'peer_disconnected' });
    channel.receive('{"type":"event","event":"x"}');
    expect(closes).toEqual([]);
    expect(messages).toHaveLength(1);
  });

  it('an oversized send throws TransportError and sends nothing', async () => {
    const { transport, channel } = await openLink();
    expect(() => transport.send({ type: 'request', id: 1, op: 'x', params: { blob: 'a'.repeat(5000) } })).toThrow(TransportError);
    expect(() => transport.send({ type: 'request', id: 1, op: 'x', params: { blob: 'a'.repeat(5000) } })).toThrow(/4096 bytes/);
    expect(channel.sent).toHaveLength(0);
  });

  it('a backed-up data channel throws TransportError("send-buffer-full")', async () => {
    const { transport, channel } = await openLink({ maxBufferedBytes: 1000 });
    channel.bufferedAmount = 5000;
    expect(() => transport.send({ type: 'request', id: 2, op: 'x', params: {} })).toThrow(/not sent earlier/);
    expect(channel.sent).toHaveLength(0);
  });

  it('send before the link is open throws ContractError DEVICE_DISCONNECTED', async () => {
    const env = await negotiate();
    expect(() => env.transport.send({ type: 'request', id: 1, op: 'x', params: {} })).toThrow(ContractError);
  });
});

describe('RemoteTransport: closing', () => {
  it('a local close after open reports initiatedBy local exactly once, and is idempotent', async () => {
    const { transport, channel, relay, closes } = await openLink();
    transport.close();
    transport.close();
    expect(closes).toEqual([{ phase: 'open', code: 1000, reason: 'closed by this page', wasClean: true, initiatedBy: 'local' }]);
    expect(channel.closeCount).toBe(1);
    expect(FakePeerConnection.instances[0].closed).toBe(true);
    expect(relay.readyState).toBe(FakeRelaySocket.CLOSED);
  });

  it('a local close while connecting rejects open once, and later closes do nothing', async () => {
    const { transport, opening, outcome, closes, relay } = await negotiate();
    transport.close();
    transport.close();
    await opening;
    expect((outcome.error as TransportOpenError).info).toMatchObject({ phase: 'connecting', initiatedBy: 'local' });
    expect(closes).toEqual([]);
    expect(relay.closeCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('after a remote close, a local close does not notify the listener again', async () => {
    const { transport, channel, closes } = await openLink();
    channel.remoteClose();
    transport.close();
    expect(closes).toHaveLength(1);
  });

  it('a close before open() is a no-op', () => {
    const transport = new RemoteTransport(TARGET, { getCredentials: vi.fn(async () => CREDS) });
    expect(() => transport.close()).not.toThrow();
  });
});

// -- secrets ------------------------------------------------------------------------------------------------------

describe('RemoteTransport: the ticket never leaves the registration frame', () => {
  it('is absent from every error, close notice and contract message the caller can see', async () => {
    const seen: unknown[] = [];

    // Successful path: a contract message round-trip and a local close.
    const ok = await openLink();
    ok.channel.receive('{"type":"response","id":1,"ok":true}');
    ok.transport.close();
    seen.push(ok.messages, ok.closes);

    // Failure paths: relay close codes and a credentials error.
    for (const code of [4001, 4003, 4008, 1006]) {
      const env = await setup();
      env.relay.serverClose(code);
      await env.opening;
      seen.push(env.outcome.error, (env.outcome.error as TransportOpenError).info, (env.outcome.error as Error).message);
    }
    const bad = await setup({ getCredentials: async () => Promise.reject(new Error(TICKET)) });
    await bad.opening;
    seen.push(bad.outcome.error, (bad.outcome.error as Error).message, (bad.outcome.error as TransportOpenError).info);

    // Post-open remote close.
    const remote = await openLink();
    remote.channel.remoteClose();
    seen.push(remote.closes);

    const serialised = seen.map((value) => {
      try {
        return `${String(value)} ${JSON.stringify(value) ?? ''}`;
      } catch {
        return String(value);
      }
    });
    for (const text of serialised) expect(text).not.toContain(TICKET);

    // On the wire the ticket appears only in registration frames, and those are the exact expected frame.
    for (const socket of FakeRelaySocket.instances) {
      for (const frame of socket.sent) {
        if (frame.includes(TICKET)) expect(frame).toBe(REGISTER);
      }
    }
  });
});
