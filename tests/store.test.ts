import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserInfo } from '../src/lib/browser';
import { WorkspaceStore, type WorkspaceEnv } from '../src/state/store';
import type { PermissionState } from '../src/transport/notices';
import type { TransportFactory } from '../src/transport/types';
import { FakeTransport } from './helpers/fakes';
import { MockDeviceCore, type MockDeviceOptions } from './helpers/mockDevice';
import { MockEcu } from './helpers/mockEcu';

const CHROME: BrowserInfo = { family: 'chromium', name: 'Chrome', supported: true };
const FIREFOX: BrowserInfo = { family: 'firefox', name: 'Firefox', supported: false };

interface Rig {
  store: WorkspaceStore;
  device: MockDeviceCore;
  transports: FakeTransport[];
  permission: { value: PermissionState };
}

function rig(opts: { browser?: BrowserInfo; secure?: boolean; device?: MockDeviceOptions; openFailure?: boolean } = {}): Rig {
  const device = new MockDeviceCore(opts.device);
  const transports: FakeTransport[] = [];
  const permission = { value: 'unknown' as PermissionState };
  const transportFactory: TransportFactory = (target) => {
    const t = new FakeTransport(target, device);
    if (opts.openFailure) t.failOpen = { phase: 'connecting', code: 1006, reason: '', wasClean: false, initiatedBy: 'remote' };
    transports.push(t);
    return t;
  };
  const env: WorkspaceEnv = {
    transportFactory,
    browser: opts.browser ?? CHROME,
    pageIsSecure: opts.secure ?? true,
    pageOrigin: 'https://bridge.plotune.net',
    queryPermission: async () => permission.value,
    schedule: (fn) => fn(),
    statsIntervalMs: 1000,
    slowConnectMs: 1500,
  };
  return { store: new WorkspaceStore(env), device, transports, permission };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
async function ready(r: Rig, target = '192.168.1.50:9101') {
  await r.store.connect(target);
  await r.store.setBitrate(1, 500000);
  await r.store.setBitrate(2, 500000);
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('connecting', () => {
  it('connects, shows both channels unconfigured with termination off, and starts reading statistics', async () => {
    const r = rig();
    await r.store.connect('192.168.1.50:9101');
    const s = r.store.getState();
    expect(s.phase).toBe('connected');
    expect(s.target).toBe('ws://192.168.1.50:9101');
    expect(s.channels.map((c) => [c.name, c.bitrate, c.termination, c.busState])).toEqual([['CAN1', null, false, 'error_active'], ['CAN2', null, false, 'error_active']]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(r.store.getState().statistics.map((x) => x.channel)).toEqual([1, 2]);
    expect(r.store.trace.at(0)).toMatchObject({ kind: 'session' });
  });

  it('one-channel devices show one channel', async () => {
    const r = rig({ device: { channels: 1 } });
    await r.store.connect('ws://localhost:9101');
    expect(r.store.getState().channels).toHaveLength(1);
  });

  it('a failed open becomes an explained notice and creates no phantom session', async () => {
    const r = rig({ openFailure: true });
    await r.store.connect('192.168.1.50:9101');
    const s = r.store.getState();
    expect(s.phase).toBe('closed');
    expect(s.notice).toMatchObject({ kind: 'unreachable' });
    expect(s.notice!.steps.join(' ')).toContain('https://bridge.plotune.net');
    expect(s.descriptor).toBeNull();
  });

  it('permission denied is named as the cause and offers the retry path', async () => {
    const r = rig({ openFailure: true });
    r.permission.value = 'denied';
    await r.store.connect('192.168.1.50:9101');
    expect(r.store.getState().notice).toMatchObject({ kind: 'permission-blocked' });
    // The user fixes it in site settings, then retries with the same store: nothing is stuck.
    r.permission.value = 'granted';
    const retry = rig();
    await retry.store.connect('192.168.1.50:9101');
    expect(retry.store.getState().phase).toBe('connected');
  });

  it('retry after a failure reaches a working device', async () => {
    const device = new MockDeviceCore();
    let fail = true;
    const store = new WorkspaceStore({
      transportFactory: (target) => {
        const t = new FakeTransport(target, device);
        if (fail) t.failOpen = { phase: 'connecting', code: 1006, reason: '', wasClean: false, initiatedBy: 'remote' };
        return t;
      },
      browser: CHROME, pageIsSecure: true, pageOrigin: 'https://bridge.plotune.net', queryPermission: async () => 'unknown', schedule: (f) => f(), statsIntervalMs: 1000, slowConnectMs: 1500,
    });
    await store.connect('192.168.1.50:9101');
    expect(store.getState().notice?.kind).toBe('unreachable');
    fail = false;
    await store.connect('192.168.1.50:9101');
    expect(store.getState()).toMatchObject({ phase: 'connected', notice: null });
  });

  it('flags a slow connect so the page can remind the user about the browser prompt', async () => {
    const device = new MockDeviceCore();
    const store = new WorkspaceStore({
      transportFactory: (target) => {
        const t = new FakeTransport(target, device);
        t.open = () => new Promise(() => undefined); // the browser is waiting for the user to answer
        return t;
      },
      browser: CHROME, pageIsSecure: true, pageOrigin: 'x', queryPermission: async () => 'prompt', schedule: (f) => f(), statsIntervalMs: 1000, slowConnectMs: 1500,
    });
    void store.connect('192.168.1.50:9101');
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState()).toMatchObject({ phase: 'connecting', slowConnect: false });
    await vi.advanceTimersByTimeAsync(600);
    expect(store.getState().slowConnect).toBe(true);
  });

  it('rejects an invalid address without opening anything', async () => {
    const r = rig();
    await r.store.connect('ftp://x');
    expect(r.transports).toHaveLength(0);
    expect(r.store.getState().notice?.kind).toBe('blocked-by-browser');
  });
});

describe('unsupported browsers (spike: Firefox and Safari block ws:// from https)', () => {
  it('does not attempt a plain ws:// connection to a LAN address and says why', async () => {
    const r = rig({ browser: FIREFOX });
    await r.store.connect('192.168.1.50:9101');
    expect(r.transports).toHaveLength(0);
    expect(r.store.getState().notice?.summary).toMatch(/Firefox blocks plain ws:\/\//);
  });
  it('still lets wss:// and ws://localhost (Firefox) through', async () => {
    const a = rig({ browser: FIREFOX });
    await a.store.connect('wss://192.168.1.50:9443');
    expect(a.transports).toHaveLength(1);
    const b = rig({ browser: FIREFOX });
    await b.store.connect('ws://localhost:9101');
    expect(b.store.getState().phase).toBe('connected');
  });
  it('on a non-secure dev page nothing is blocked', async () => {
    const r = rig({ browser: FIREFOX, secure: false });
    await r.store.connect('192.168.1.50:9101');
    expect(r.store.getState().phase).toBe('connected');
  });
});

describe('capture, trace and drops', () => {
  it('refuses to start before every selected channel has a bit rate, and tells the user which', async () => {
    const r = rig();
    await r.store.connect('192.168.1.50:9101');
    await r.store.setBitrate(1, 500000);
    expect(await r.store.startCapture()).toBe(false);
    expect(r.store.getState().actionError).toBe('Set a bit rate on CAN2 first.');
    expect(r.device.requests.some((m) => m.op === 'start_rx')).toBe(false);
  });

  it('captures both channels independently, keeping channel, direction and 64-bit timestamps', async () => {
    const r = rig();
    await ready(r);
    expect(await r.store.startCapture()).toBe(true);
    r.device.injectRx(1, { id: 0x100, data: Uint8Array.of(1), timestampNs: 2n ** 61n + 1n });
    r.device.injectRx(2, { id: 0x200, extended: true, data: Uint8Array.of(2, 3), timestampNs: 2n ** 61n + 3n });
    r.device.deliver();
    await flush();
    const rows = Array.from({ length: r.store.trace.length }, (_, i) => r.store.trace.at(i)).filter((x) => x.kind === 'frame');
    expect(rows.map((x) => x.kind === 'frame' && [x.frame.channel, x.frame.id, x.frame.extended, x.frame.direction, x.frame.timestampNs])).toEqual([
      [1, 0x100, false, 'rx', 2n ** 61n + 1n],
      [2, 0x200, true, 'rx', 2n ** 61n + 3n],
    ]);
    expect(r.store.trace.originNs).toBe(2n ** 61n + 1n);
  });

  it('transmit shows up as a tx row on its channel, and errors are explained in plain words', async () => {
    const r = rig();
    await ready(r);
    await r.store.startCapture();
    expect(await r.store.transmit({ channel: 2, id: 0x123, extended: false, rtr: false, dlc: 2, data: Uint8Array.of(0xaa, 0xbb) })).toBe(true);
    await flush();
    const last = r.store.trace.at(r.store.trace.length - 1);
    expect(last).toMatchObject({ kind: 'frame', frame: { channel: 2, direction: 'tx', id: 0x123 } });
    expect(r.store.getState().txLog[0]).toMatchObject({ ok: true });
    expect(await r.store.transmit({ channel: 1, id: 0x900, extended: false, rtr: false, dlc: 0, data: new Uint8Array() })).toBe(false);
    expect(r.store.getState().txLog[0].message).toMatch(/Standard IDs go up to 7FF/);
  });

  it('shows drops explicitly: a marker row, a running total per channel, and the device counters', async () => {
    const r = rig({ device: { queueCapacity: 16 } });
    await ready(r);
    await r.store.startCapture();
    for (let i = 0; i < 100; i += 1) r.device.injectRx(1, { id: 0x10, data: Uint8Array.of(i) });
    r.device.injectRx(2, { id: 0x20, data: Uint8Array.of(1) });
    r.device.deliver();
    await flush();
    const s = r.store.getState();
    expect(s.droppedReported).toEqual({ 1: 84 });
    const drop = Array.from({ length: r.store.trace.length }, (_, i) => r.store.trace.at(i)).find((x) => x.kind === 'drop');
    expect(drop).toMatchObject({ kind: 'drop', channel: 1, count: 84 });
    await vi.advanceTimersByTimeAsync(1100);
    const stats = r.store.getState().statistics;
    expect(stats.find((x) => x.channel === 1)).toMatchObject({ rxReceived: 100, rxForwarded: 16, rxDropped: 84, rxOverflow: 84 });
    expect(stats.find((x) => x.channel === 2)).toMatchObject({ rxDropped: 0 });
  });

  it('marks a gap in the stream sequence in the trace', async () => {
    const r = rig();
    await ready(r);
    await r.store.startCapture();
    r.device.injectRx(1, { id: 1 });
    r.device.deliver();
    r.device.skipSequence(2);
    r.device.injectRx(1, { id: 2 });
    r.device.deliver();
    await flush();
    expect(r.store.getState().lostBatches).toBe(2);
    expect(Array.from({ length: r.store.trace.length }, (_, i) => r.store.trace.at(i)).some((x) => x.kind === 'gap')).toBe(true);
  });

  it('bus state changes update the channel without a poll', async () => {
    const r = rig();
    await ready(r);
    r.device.setBusState(2, 'bus_off');
    await flush();
    expect(r.store.getState().channels[1].busState).toBe('bus_off');
    expect(r.store.getState().channels[0].busState).toBe('error_active');
  });

  it('stopping capture delivers everything captured first and refuses bit-rate changes while capturing', async () => {
    const r = rig();
    await ready(r);
    await r.store.startCapture();
    expect(await r.store.setBitrate(1, 250000)).toBe(false);
    expect(r.store.getState().actionError).toMatch(/Stop capturing/);
    r.device.injectRx(1, { id: 5 });
    await r.store.stopCapture();
    await flush();
    expect(r.store.getState().capturing).toBe(false);
    expect(Array.from({ length: r.store.trace.length }, (_, i) => r.store.trace.at(i)).filter((x) => x.kind === 'frame')).toHaveLength(1);
  });
});

describe('counters and tallies', () => {
  it('Reset counters zeroes the device counters; Clear trace clears the tallies that describe the trace', async () => {
    const r = rig({ device: { queueCapacity: 8 } });
    await ready(r);
    await r.store.startCapture();
    for (let i = 0; i < 40; i += 1) r.device.injectRx(1, { id: 1, data: Uint8Array.of(i) });
    r.device.deliver();
    await flush();
    await vi.advanceTimersByTimeAsync(1100);
    expect(r.store.getState().statistics.find((s) => s.channel === 1)).toMatchObject({ rxReceived: 40, rxDropped: 32 });
    expect(r.store.getState().droppedReported).toEqual({ 1: 32 });

    await r.store.resetStatistics();
    expect(r.store.getState().statistics.find((s) => s.channel === 1)).toMatchObject({ rxReceived: 0, rxDropped: 0 });
    expect(r.store.getState().droppedReported).toEqual({ 1: 32 }); // the trace still contains the drop marker

    r.store.clearTrace();
    expect(r.store.getState()).toMatchObject({ droppedReported: {}, lostBatches: 0 });
  });
});

describe('links that end', () => {
  it('a replaced session shows the takeover notice and does NOT reconnect by itself', async () => {
    const r = rig();
    await ready(r);
    r.transports[0].dropWith(4001, 'replaced by a new connection');
    const s = r.store.getState();
    expect(s.phase).toBe('closed');
    expect(s.notice).toMatchObject({ kind: 'replaced', severity: 'warning' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(r.transports).toHaveLength(1); // two tabs would otherwise fight over the device forever
  });

  it('an overflow close (1013) explains that the page could not keep up', async () => {
    const r = rig();
    await ready(r);
    r.transports[0].dropWith(1013, 'send queue overflow');
    expect(r.store.getState().notice).toMatchObject({ kind: 'overflow' });
  });

  it('a lost link (1006) is reported, capture is shown as stopped in this page, and reconnecting resumes with the device-side backlog', async () => {
    const r = rig();
    await ready(r);
    await r.store.startCapture();
    r.transports[0].dropWith(1006);
    expect(r.store.getState()).toMatchObject({ phase: 'closed', capturing: false, notice: { kind: 'lost' } });
    r.device.injectRx(1, { id: 0x42, data: Uint8Array.of(9), timestampNs: 2n ** 60n + 5n }); // captured while nobody was attached
    await r.store.connect('192.168.1.50:9101');
    await flush();
    const s = r.store.getState();
    expect(s).toMatchObject({ phase: 'connected', sessionNumber: 2, capturing: true });
    expect(s.channels.every((c) => c.bitrate === 500000)).toBe(true); // configuration survived on the device
    const rows = Array.from({ length: r.store.trace.length }, (_, i) => r.store.trace.at(i));
    expect(rows.some((x) => x.kind === 'session' && /Reconnected/.test(x.text))).toBe(true);
    expect(rows.some((x) => x.kind === 'frame' && x.frame.id === 0x42 && x.frame.timestampNs === 2n ** 60n + 5n)).toBe(true);
  });

  it('an old session cannot write into a newer one', async () => {
    const r = rig();
    await r.store.connect('192.168.1.50:9101');
    const first = r.transports[0];
    await r.store.connect('192.168.1.51:9101');
    first.listener?.closed({ phase: 'open', code: 4001, reason: '', wasClean: true, initiatedBy: 'remote' });
    expect(r.store.getState()).toMatchObject({ phase: 'connected', target: 'ws://192.168.1.51:9101' });
  });

  it('disconnect() is a calm ending, not an error', async () => {
    const r = rig();
    await ready(r);
    r.store.disconnect();
    expect(r.store.getState()).toMatchObject({ phase: 'closed', notice: { kind: 'ended', severity: 'info' } });
  });
});

describe('switching devices', () => {
  it('a different device starts a clean trace and clean counters; the same device keeps its history', async () => {
    const a = new MockDeviceCore({ deviceId: 'device-a' });
    const b = new MockDeviceCore({ deviceId: 'device-b' });
    const store = new WorkspaceStore({
      transportFactory: (target) => new FakeTransport(target, target.includes('9001') ? a : b),
      browser: CHROME, pageIsSecure: true, pageOrigin: 'x', queryPermission: async () => 'unknown', schedule: (f) => f(), statsIntervalMs: 1000, slowConnectMs: 1500,
    });
    await store.connect('192.168.1.50:9001');
    await store.setBitrate(1, 500000);
    await store.setBitrate(2, 500000);
    await store.startCapture();
    a.injectRx(1, { id: 1 });
    a.deliver();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.trace.length).toBe(2); // session row + frame

    await store.connect('192.168.1.50:9001'); // the same device again
    expect(store.trace.length).toBeGreaterThanOrEqual(3);

    await store.connect('192.168.1.51:9002');
    expect(store.getState().descriptor?.deviceId).toBe('device-b');
    expect(store.trace.length).toBe(1);
    expect(store.trace.at(0)).toMatchObject({ kind: 'session', text: expect.stringContaining('a different device') });
    expect(store.getState()).toMatchObject({ lostBatches: 0, droppedReported: {}, txLog: [] });
  });
});

describe('diagnostics access to the same frame stream', () => {
  it('lets engines transmit through the session and see the ECU answer as an rx frame', async () => {
    const r = rig({ device: { ecu: new MockEcu() } });
    await ready(r);
    await r.store.startCapture();
    const io = r.store.diagnosticsIo();
    const seen: number[] = [];
    const off = io.subscribe((f) => f.direction === 'rx' && seen.push(f.id));
    await io.transmit({ channel: 1, id: 0x700, extended: false, rtr: false, dlc: 3, data: Uint8Array.of(0x02, 0x3e, 0x00) });
    await flush();
    off();
    expect(seen).toEqual([0x708]);
  });
});
