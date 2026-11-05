// BR-WEB-004 rev 2 acceptance evidence — clause (c) at the connection layer and clause (d) for a device swap.
// Observable behaviour of the real WorkspaceStore against a contract-faithful MockDeviceCore:
// a failed connection, a replaced session or a lost link must never trigger a silent automatic retry;
// reconnection is an explicit user action. Connecting to a different device must not replay hardware commands.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserInfo } from '../src/lib/browser';
import { WorkspaceStore, type WorkspaceEnv } from '../src/state/store';
import type { PermissionState } from '../src/transport/notices';
import type { TransportFactory } from '../src/transport/types';
import { FakeTransport } from './helpers/fakes';
import { MockDeviceCore, type MockDeviceOptions } from './helpers/mockDevice';

const CHROME: BrowserInfo = { family: 'chromium', name: 'Chrome', supported: true };
const ENERGIZING = ['set_bitrate', 'set_termination', 'start_rx', 'stop_rx', 'transmit'];

interface Rig {
  store: WorkspaceStore;
  device: MockDeviceCore;
  transports: FakeTransport[];
  permission: { value: PermissionState };
}

function envFor(transportFactory: TransportFactory): WorkspaceEnv {
  return {
    transportFactory,
    browser: CHROME,
    pageIsSecure: true,
    pageOrigin: 'https://bridge.plotune.net',
    queryPermission: async () => 'unknown',
    schedule: (fn) => fn(),
    statsIntervalMs: 1000,
    slowConnectMs: 1e9,
  };
}

function rig(opts: { device?: MockDeviceOptions; openFailure?: boolean } = {}): Rig {
  const device = new MockDeviceCore(opts.device);
  const transports: FakeTransport[] = [];
  const permission = { value: 'unknown' as PermissionState };
  const transportFactory: TransportFactory = (target) => {
    const t = new FakeTransport(target, device);
    if (opts.openFailure) t.failOpen = { phase: 'connecting', code: 1006, reason: '', wasClean: false, initiatedBy: 'remote' };
    transports.push(t);
    return t;
  };
  return { store: new WorkspaceStore(envFor(transportFactory)), device, transports, permission };
}

async function ready(r: Rig, target = 'localhost:9101') {
  await r.store.connect(target);
  await r.store.setBitrate(1, 500000);
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('BR-WEB-004 (c) explicit reconnection after failure / replacement, no silent retry', () => {
  it('a failed connection is reported with an actionable notice and is never retried by itself', async () => {
    const r = rig({ openFailure: true });
    await r.store.connect('localhost:9101');
    expect(r.store.getState().phase).toBe('closed');
    expect(r.store.getState().notice).toMatchObject({ kind: 'unreachable', severity: 'error' });
    expect(r.store.getState().notice?.steps.length).toBeGreaterThan(0);
    expect(r.transports).toHaveLength(1);
    // Even after a long wait, nothing starts a connection on its own.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(r.transports).toHaveLength(1);
    expect(r.store.getState().phase).toBe('closed');
  });

  it('a session replacement (another window takes over) is reported and NOT reconnected by itself', async () => {
    const r = rig();
    await ready(r);
    r.transports[0].dropWith(4001, 'replaced by a new connection');
    expect(r.store.getState().phase).toBe('closed');
    expect(r.store.getState().notice).toMatchObject({ kind: 'replaced', severity: 'warning' });
    // The notice asks the user to connect again (explicit), rather than the page doing it.
    expect(r.store.getState().notice?.steps.join(' ')).toMatch(/Connect again/);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(r.transports).toHaveLength(1); // two tabs would otherwise fight over the device forever
  });

  it('a lost link is reported, no automatic retry happens, and reconnecting is an explicit action', async () => {
    const r = rig();
    await ready(r);
    await r.store.startCapture();
    r.transports[0].dropWith(1006);
    expect(r.store.getState()).toMatchObject({ phase: 'closed', capturing: false, notice: { kind: 'lost' } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(r.transports).toHaveLength(1); // no silent retry
    // Only an explicit connect re-establishes the link.
    await r.store.connect('localhost:9101');
    expect(r.transports).toHaveLength(2);
    expect(r.store.getState().phase).toBe('connected');
  });
});

describe('BR-WEB-004 (d) a device replacement replays no hardware commands', () => {
  it('connecting to a different device clears the earlier trace and issues no config/capture/transmit command', async () => {
    const a = new MockDeviceCore({ deviceId: 'dev-A' });
    const b = new MockDeviceCore({ deviceId: 'dev-B' });
    const transportFactory: TransportFactory = (target) =>
      new FakeTransport(target, target.includes('9121') ? b : a);
    const store = new WorkspaceStore(envFor(transportFactory));

    await store.connect('localhost:9101'); // dev-A
    await store.setBitrate(1, 500000);
    await store.startCapture();
    expect(a.requests.some((m) => m.op === 'start_rx')).toBe(true);

    // The user points the same slot at a different device: an explicit connect, not a replay.
    await store.connect('localhost:9121'); // dev-B
    expect(store.getState().descriptor?.deviceId).toBe('dev-B');
    expect(store.getState().txLog).toEqual([]);
    const bOps = b.requests.map((m) => m.op as string);
    expect(bOps.filter((op) => ENERGIZING.includes(op))).toEqual([]);
    expect(bOps).toContain('hello');
    const rows = Array.from({ length: store.trace.length }, (_, i) => store.trace.at(i));
    expect(rows.some((row) => row.kind === 'session' && /different device/.test(row.text))).toBe(true);
  });
});
