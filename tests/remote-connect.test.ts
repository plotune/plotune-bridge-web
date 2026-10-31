// Remote targets through the store: no local-network rules, cloud failure reasons explained, remembered devices.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserInfo } from '../src/lib/browser';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import type { CloseInfo } from '../src/transport/types';
import { FakeTransport } from './helpers/fakes';
import { MockDeviceCore } from './helpers/mockDevice';

const FIREFOX: BrowserInfo = { family: 'firefox', name: 'Firefox', supported: false };
const CHROME: BrowserInfo = { family: 'chromium', name: 'Chrome', supported: true };
const TARGET = 'remote:proj_1/dev-1';

function remoteRig(failOpen: CloseInfo | null = null, browser: BrowserInfo = FIREFOX) {
  const device = new MockDeviceCore();
  const targets: string[] = [];
  const transports: FakeTransport[] = [];
  const queryPermission = vi.fn(async () => 'granted' as const);
  const store = new WorkspaceStore(
    defaultEnv({
      transportFactory: (target) => {
        targets.push(target);
        const transport = new FakeTransport(target, device);
        transport.failOpen = failOpen;
        transports.push(transport);
        return transport;
      },
      browser,
      pageIsSecure: true,
      queryPermission,
      schedule: (fn) => fn(),
      statsIntervalMs: 1000,
      slowConnectMs: 1500,
    }),
  );
  return { store, targets, transports, queryPermission };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('remote targets in the store', () => {
  it('connects through the transport without the local-network permission query or the direct-connection browser rules', async () => {
    // Firefox on a secure page blocks plain ws:// addresses; a remote target is not a plain ws:// address.
    const r = remoteRig();
    await r.store.connect(TARGET);
    await flush();
    const state = r.store.getState();
    expect(state.phase).toBe('connected');
    expect(state.target).toBe(TARGET);
    expect(state.notice).toBeNull();
    expect(r.targets).toEqual([TARGET]);
    expect(r.queryPermission).not.toHaveBeenCalled();
    expect(state.slowConnect).toBe(false);
    r.store.disconnect();
  });

  it.each([
    ['not-signed-in', 'signed-out', 'Sign in to reconnect to this device'],
    ['no-access', 'no-access', 'Your account cannot use this device'],
    ['not-found', 'not-found', 'This device is not paired to the project'],
    ['cloud-unavailable', 'cloud-unavailable', 'The Plotune cloud could not set up the connection'],
    ['device is not online', 'device-offline', 'The device is offline'],
    ['timeout', 'timeout', 'The device did not answer'],
  ])('explains the %s failure as %s', async (reason, kind, title) => {
    const r = remoteRig({ phase: 'connecting', code: null, reason, wasClean: false, initiatedBy: 'local' });
    await r.store.connect(TARGET);
    const state = r.store.getState();
    expect(state.phase).toBe('closed');
    expect(state.notice).toMatchObject({ kind, title });
    // One attempt per user action: a failed remote connection is never retried by the store.
    expect(r.transports).toHaveLength(1);
  });

  it('keeps a remembered remote device as a sign-in notice until the user connects, without starting a connection', () => {
    const r = remoteRig();
    r.store.restorePreferences({ target: TARGET, captureChannels: [1, 2], transmitChannel: 1 });
    const state = r.store.getState();
    expect(state.phase).toBe('closed');
    expect(state.target).toBe(TARGET);
    expect(state.notice).toMatchObject({ kind: 'signed-out', title: 'Sign in to reconnect to this device' });
    expect(r.transports).toHaveLength(0);
  });

  it('keeps the direct-address restore notice unchanged', () => {
    const r = remoteRig();
    r.store.restorePreferences({ target: 'ws://192.168.1.50:9101', captureChannels: [1, 2], transmitChannel: 1 });
    expect(r.store.getState().notice).toMatchObject({ kind: 'ended', title: 'Ready to reconnect' });
  });

  it('explains a direct address that cannot open in the direct-address terms, not the cloud terms', async () => {
    const r = remoteRig({ phase: 'connecting', code: 1006, reason: '', wasClean: false, initiatedBy: 'remote' }, CHROME);
    await r.store.connect('192.168.1.50:9101');
    expect(r.store.getState().notice).toMatchObject({ kind: 'unreachable', title: "Couldn't connect to the device" });
  });
});
