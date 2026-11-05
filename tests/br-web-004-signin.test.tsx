// BR-WEB-004 rev 2 acceptance evidence — clauses (a) account credentials, (b) one automatic reconnect per sign-in,
// and (c) no silent retry / explicit reconnection, at the app level with the existing cloud + SSO fakes.
// A "successful sign-in" is a full (faked) OAuth round trip: prompt=none redirect, callback fragment, code exchange,
// token set in memory. The real plotune.net identity service cannot be reached locally (recorded as unverified).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { type CloudClient, type CloudDevice } from '../src/cloud/client';
import { createCloudSession, type CloudSession } from '../src/cloud/session';
import { DeviceHub } from '../src/state/hub';
import { WORKSPACE_KEY, WorkspacePersistence, type SavedDevice } from '../src/state/persistence';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { TransportOpenError, type CloseInfo, type DeviceTransport } from '../src/transport/types';
import { fakeSso, stateFromRedirect, type FakeSso } from './helpers/sso';

const BROWSER = { family: 'chromium', name: 'Chrome', supported: true } as const;
const CODE = 'c'.repeat(43);
const TOKEN = 'account-token-br-web-004';
const REMOTE = 'remote:proj_1/dev-1';
const LOCAL = 'ws://192.168.1.50:9101';
const REMEMBERED_REMOTE: SavedDevice = { id: 'd1', label: 'Bridge 1', target: REMOTE, captureChannels: [1, 2], transmitChannel: 1 };
const REMEMBERED_LOCAL: SavedDevice = { id: 'd2', label: 'Bridge 2', target: LOCAL, captureChannels: [1, 2], transmitChannel: 1 };
const FIRST_OPEN_FAILED: CloseInfo = { phase: 'connecting', code: null, reason: 'not-found', wasClean: false, initiatedBy: 'local' };

interface Rig {
  client: CloudClient;
  sso: FakeSso;
  session: CloudSession;
  hub: DeviceHub;
  origin: string;
  factory: ReturnType<typeof vi.fn<(target: string) => DeviceTransport>>;
  /** Each transport's pending open(), so a test decides when a connection attempt answers. */
  opens: Map<string, { resolve: () => void; reject: (error: unknown) => void }>;
}

function seedWorkspace(devices: SavedDevice[]): void {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
    version: 1, devices, activeId: devices[0]?.id ?? '', traceView: 'all', page: 'capture',
    hidden: { capture: [], diagnostics: [], device: [] }, diagnostics: {}, permissionExplained: true,
  }));
}

function controlledTransport(target: string, opens: Rig['opens']): DeviceTransport {
  return {
    kind: 'fake', target,
    open: () => new Promise<void>((resolve, reject) => { opens.set(target, { resolve, reject }); }),
    send: () => undefined, close: () => undefined, setListener: () => undefined,
  };
}

/** silentFailed:false so each fresh page load makes the automatic (prompt=none) attempt, like a real first open. */
function makeRig(options: { devices?: SavedDevice[] } = {}): Rig {
  seedWorkspace(options.devices ?? [REMEMBERED_REMOTE]);
  const devices: CloudDevice[] = [];
  const client: CloudClient = {
    exchangeBridgeCode: vi.fn(async () => ({ accessToken: TOKEN, expiresIn: 28800, username: 'kantr' })),
    listProjects: vi.fn(async () => [{ id: 'proj_1', name: 'Lab', role: 'Owner' }]),
    listDevices: vi.fn(async () => devices),
    createPairingToken: vi.fn(async () => ({ pairingToken: 'plt_pair_x', expiresAt: 0, expiresIn: 120 })),
    createBrowserTicket: vi.fn(async () => ({ ticket: 'ticket', expiresAt: 0 })),
    fetchIceServers: vi.fn(async () => ({ iceServers: [], expiresAt: 0 })),
  };
  const rig = {} as Rig;
  rig.opens = new Map();
  rig.factory = vi.fn((target: string) => controlledTransport(target, rig.opens));
  rig.client = client;
  rig.sso = fakeSso({ silentFailed: false });
  rig.session = createCloudSession();
  rig.origin = 'https://bridge.plotune.net';
  rig.hub = null as unknown as DeviceHub;
  return rig;
}

/** A page load: a fresh in-memory session and a hub restored from the saved workspace, as on a real reload. */
function load(rig: Rig): void {
  cleanup();
  rig.session = createCloudSession();
  rig.hub = new DeviceHub(
    () => new WorkspaceStore(defaultEnv({ transportFactory: rig.factory, browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown', schedule: (fn) => fn(), slowConnectMs: 1e9 })),
    (fn) => fn(),
    new WorkspacePersistence(),
  );
  render(<App hub={rig.hub} browser={BROWSER} pageOrigin={rig.origin} cloudClient={rig.client} cloudSession={rig.session} cloudSso={rig.sso} />);
}

function returnWith(rig: Rig, params: Record<string, string>): void {
  rig.sso.state.hash = `#${new URLSearchParams(params).toString()}`;
  load(rig);
}

const connectsTo = (rig: Rig, target: string) => rig.factory.mock.calls.filter(([t]) => t === target).length;
const targets = (rig: Rig) => rig.factory.mock.calls.map(([target]) => target);

beforeEach(() => { localStorage.clear(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('BR-WEB-004 (a) account credentials are never persisted', () => {
  it('a successful sign-in keeps the token and one-time code out of every storage surface', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const rig = makeRig();
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso) });
    await waitFor(() => expect(connectsTo(rig, REMOTE)).toBe(1));

    // The account token lives only in the in-memory session.
    expect(rig.session.getToken()).toBe(TOKEN);
    for (const [, value] of setItem.mock.calls) {
      expect(String(value)).not.toContain(TOKEN);
      expect(String(value)).not.toContain(CODE);
    }
    for (const value of rig.sso.storage.data.values()) {
      expect(String(value)).not.toContain(TOKEN);
      expect(String(value)).not.toContain(CODE);
    }
    expect(document.body.innerHTML).not.toContain(TOKEN);

    // The persisted workspace holds only allowlisted fields and no credential material.
    const saved = JSON.parse(localStorage.getItem(WORKSPACE_KEY)!);
    expect(Object.keys(saved).sort()).toEqual(['activeId', 'devices', 'diagnostics', 'hidden', 'page', 'permissionExplained', 'traceView', 'version']);
    expect(Object.keys(saved.devices[0]).sort()).toEqual(['captureChannels', 'id', 'label', 'target', 'transmitChannel']);
    expect(localStorage.getItem(WORKSPACE_KEY)!).not.toMatch(/token|password|ticket|verifier|secret/i);
  });
});

describe('BR-WEB-004 (b) at most one automatic reconnect after a successful sign-in', () => {
  it('one sign-in starts exactly one reconnect of the remembered remote device, and nothing else is auto-started', async () => {
    const rig = makeRig({ devices: [REMEMBERED_REMOTE, REMEMBERED_LOCAL] });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso) });
    await waitFor(() => expect(connectsTo(rig, REMOTE)).toBe(1));
    await act(async () => undefined);
    // A remembered local device and any other device are never started by a sign-in.
    expect(connectsTo(rig, LOCAL)).toBe(0);
    expect(targets(rig)).toEqual([REMOTE]);
    // No second automatic reconnect for the same sign-in.
    await act(async () => undefined);
    expect(connectsTo(rig, REMOTE)).toBe(1);
  });

  it('a reload before a new sign-in reconnects nothing; only the next successful sign-in allows one more', async () => {
    const rig = makeRig();
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso, 0) });
    await waitFor(() => expect(connectsTo(rig, REMOTE)).toBe(1));

    // Reload: a fresh session makes its own automatic attempt, but no reconnect without a sign-in.
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(2));
    expect(connectsTo(rig, REMOTE)).toBe(1);

    // The next successful sign-in is a new session generation and gets exactly one more reconnect.
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso, 1) });
    await waitFor(() => expect(connectsTo(rig, REMOTE)).toBe(2));
    await act(async () => undefined);
    expect(connectsTo(rig, REMOTE)).toBe(2);
  });
});

describe('BR-WEB-004 (c) a failed automatic reconnect is not retried silently; reconnection is explicit', () => {
  it('a failed reconnect leaves the device closed, offers an explicit Reconnect, and only a user click reconnects', async () => {
    const rig = makeRig();
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso) });
    await waitFor(() => expect(rig.opens.has(REMOTE)).toBe(true));

    // The single automatic attempt fails.
    await act(async () => { rig.opens.get(REMOTE)!.reject(new TransportOpenError(FIRST_OPEN_FAILED, 'not found')); });
    await act(async () => undefined);

    // No silent retry: the queue attempted the device once and settled.
    expect(connectsTo(rig, REMOTE)).toBe(1);
    expect(rig.hub.getState().queueSettledFor).not.toBeNull();
    expect(rig.hub.slot('d1')!.store.getState().phase).toBe('closed');
    expect(screen.queryByText('Waiting to connect…')).toBeNull();

    // The user is offered an explicit reconnection action.
    const reconnect = await screen.findByRole('button', { name: 'Reconnect' });
    const before = connectsTo(rig, REMOTE);
    fireEvent.click(reconnect);
    expect(connectsTo(rig, REMOTE)).toBe(before + 1);
    expect(targets(rig).at(-1)).toBe(REMOTE);
  });
});
