// Regression tests for the PR #20 review: (1) the fallback ends a callback that is still exchanging, (2) the reconnect
// queue rechecks each device and the session before connecting it, (3) a closed remembered device offers Reconnect when
// signed in. Every network answer and every open is a controlled promise, and the clock is faked, so nothing is timing-dependent.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { type BridgeToken, type CloudClient } from '../src/cloud/client';
import { createCloudSession, type CloudSession } from '../src/cloud/session';
import { SILENT_FAILED_KEY } from '../src/cloud/sso';
import { CONTINUE_WITHOUT_MS } from '../src/components/SignInPending';
import { DeviceHub } from '../src/state/hub';
import { WORKSPACE_KEY, WorkspacePersistence, type SavedDevice } from '../src/state/persistence';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { TransportOpenError, type CloseInfo, type DeviceTransport } from '../src/transport/types';
import { fakeSso, stateFromRedirect, type FakeSso } from './helpers/sso';

const BROWSER = { family: 'chromium', name: 'Chrome', supported: true } as const;
const CODE = 'c'.repeat(43);
const TOKEN = 'account-token-regressions';
const DEV1 = 'remote:proj_1/dev-1';
const DEV2 = 'remote:proj_1/dev-2';
const DEVICE1: SavedDevice = { id: 'd1', label: 'Bridge 1', target: DEV1, captureChannels: [1, 2], transmitChannel: 1 };
const DEVICE2: SavedDevice = { id: 'd2', label: 'Bridge 2', target: DEV2, captureChannels: [1, 2], transmitChannel: 1 };
const TOKEN_FROM_EXCHANGE: BridgeToken = { accessToken: TOKEN, expiresIn: 28800, username: 'kantr' };
const FIRST_OPEN_FAILED: CloseInfo = { phase: 'connecting', code: null, reason: 'not-found', wasClean: false, initiatedBy: 'local' };

interface Rig {
  client: CloudClient;
  sso: FakeSso;
  session: CloudSession;
  hub: DeviceHub;
  /** The open of each transport, by target, so a test decides when each connection attempt answers. */
  opens: Map<string, { resolve: () => void; reject: (error: unknown) => void }>;
  factory: ReturnType<typeof vi.fn<(target: string) => DeviceTransport>>;
  finishExchange: (value: BridgeToken) => void;
}

function controlledTransport(target: string, opens: Rig['opens']): DeviceTransport {
  return {
    kind: 'fake',
    target,
    open: () => new Promise<void>((resolve, reject) => opens.set(target, { resolve, reject })),
    send: () => undefined,
    close: () => undefined,
    setListener: () => undefined,
  };
}

function seed(devices: SavedDevice[]): void {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
    version: 1, devices, activeId: devices[0]?.id ?? '', traceView: 'all', page: 'capture',
    hidden: { capture: [], diagnostics: [], device: [] }, diagnostics: {}, permissionExplained: true,
  }));
}

/** The exchange answers only when the test says so: a callback that is still exchanging for as long as the test wants. */
function makeRig(options: { silentFailed?: boolean; devices?: SavedDevice[] } = {}): Rig {
  seed(options.devices ?? [DEVICE1, DEVICE2]);
  const opens: Rig['opens'] = new Map();
  let finish: (value: BridgeToken) => void = () => undefined;
  const rig = {} as Rig;
  rig.opens = opens;
  rig.finishExchange = (value) => finish(value);
  rig.factory = vi.fn((target: string) => controlledTransport(target, opens));
  rig.client = {
    exchangeBridgeCode: vi.fn(() => new Promise<BridgeToken>((resolve) => { finish = resolve; })),
    listProjects: vi.fn(async () => [{ id: 'proj_1', name: 'Lab', role: 'Owner' }]),
    listDevices: vi.fn(async () => []),
    createPairingToken: vi.fn(async () => ({ pairingToken: 'plt_pair_x', expiresAt: 0, expiresIn: 120 })),
    createBrowserTicket: vi.fn(async () => ({ ticket: 'ticket', expiresAt: 0 })),
    fetchIceServers: vi.fn(async () => ({ iceServers: [], expiresAt: 0 })),
  };
  rig.sso = fakeSso({ silentFailed: options.silentFailed ?? false });
  rig.session = createCloudSession();
  return rig;
}

/** A page load: a fresh session, a hub restored from the saved workspace. */
function load(rig: Rig): void {
  cleanup();
  rig.session = createCloudSession();
  rig.hub = new DeviceHub(
    () => new WorkspaceStore(defaultEnv({ transportFactory: rig.factory, browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown', schedule: (fn) => fn(), slowConnectMs: 1e9 })),
    (fn) => fn(),
    new WorkspacePersistence(),
  );
  render(<App hub={rig.hub} browser={BROWSER} pageOrigin="https://bridge.plotune.net" cloudClient={rig.client} cloudSession={rig.session} cloudSso={rig.sso} />);
}

/** Runs the automatic attempt to plotune.net and returns through the callback, which then exchanges and signs in. */
async function signInThroughCallback(rig: Rig): Promise<void> {
  load(rig);
  await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
  rig.sso.state.hash = `#code=${CODE}&state=${stateFromRedirect(rig.sso)}`;
  load(rig);
}

const factoryTargets = (rig: Rig) => rig.factory.mock.calls.map(([target]) => target);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('finding 1: the fallback ends a callback that is still exchanging', () => {
  it('"Continue without signing in" shows the workspace, and a late exchange answer signs nobody in', async () => {
    const rig = makeRig({ silentFailed: false });
    await signInThroughCallback(rig);
    // The exchange has not answered: the sign-in state is up, and the fallback arrives after 20 seconds.
    await act(async () => {
      vi.advanceTimersByTime(CONTINUE_WITHOUT_MS);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue without signing in' }));

    expect(await screen.findByRole('navigation', { name: 'Workspace' })).toBeVisible();
    expect(screen.queryByRole('status')).toBeNull();
    expect(rig.sso.storage.data.get(SILENT_FAILED_KEY)).toBe('1');

    // The exchange answers late: it must change nothing.
    await act(async () => rig.finishExchange(TOKEN_FROM_EXCHANGE));
    expect(rig.session.getToken()).toBeNull();
    expect(screen.queryByRole('button', { name: 'kantr' })).toBeNull();
    expect(rig.client.listProjects).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(factoryTargets(rig)).toEqual([]);
  });
});

describe('finding 2: the reconnect queue is rechecked before each device', () => {
  it('a device removed while the queue waits is not connected', async () => {
    const rig = makeRig();
    await signInThroughCallback(rig);
    await act(async () => rig.finishExchange(TOKEN_FROM_EXCHANGE));
    await waitFor(() => expect(rig.opens.has(DEV1)).toBe(true));

    act(() => rig.hub.removeDevice('d2'));
    await act(async () => rig.opens.get(DEV1)!.reject(new TransportOpenError(FIRST_OPEN_FAILED, 'not found')));
    await act(async () => undefined);

    expect(factoryTargets(rig).filter((target) => target === DEV2)).toEqual([]);
  });

  it('a device connected by hand while the queue waits is not started a second time', async () => {
    const rig = makeRig();
    await signInThroughCallback(rig);
    await act(async () => rig.finishExchange(TOKEN_FROM_EXCHANGE));
    await waitFor(() => expect(rig.opens.has(DEV1)).toBe(true));

    await act(async () => {
      void rig.hub.slot('d2')!.store.connect(DEV2);
    });
    expect(factoryTargets(rig).filter((target) => target === DEV2)).toHaveLength(1);

    await act(async () => rig.opens.get(DEV1)!.reject(new TransportOpenError(FIRST_OPEN_FAILED, 'not found')));
    await act(async () => undefined);

    expect(factoryTargets(rig).filter((target) => target === DEV2)).toHaveLength(1);
  });

  it('signing out stops the queue, so the next device is not connected', async () => {
    const rig = makeRig();
    await signInThroughCallback(rig);
    await act(async () => rig.finishExchange(TOKEN_FROM_EXCHANGE));
    await waitFor(() => expect(rig.opens.has(DEV1)).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'kantr' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await act(async () => rig.opens.get(DEV1)!.reject(new TransportOpenError(FIRST_OPEN_FAILED, 'not found')));
    await act(async () => undefined);

    expect(factoryTargets(rig).filter((target) => target === DEV2)).toEqual([]);
  });

  it('a replaced account token stops the queue', async () => {
    const rig = makeRig();
    await signInThroughCallback(rig);
    await act(async () => rig.finishExchange(TOKEN_FROM_EXCHANGE));
    await waitFor(() => expect(rig.opens.has(DEV1)).toBe(true));

    // A replaced token is a new sign-in: the queue for the new session connects the waiting device once. The queue of the
    // old session must not connect it again when its own connection finishes.
    act(() => rig.session.setToken('a-replacement-token'));
    await waitFor(() => expect(factoryTargets(rig).filter((target) => target === DEV2)).toHaveLength(1));
    await act(async () => rig.opens.get(DEV1)!.reject(new TransportOpenError(FIRST_OPEN_FAILED, 'not found')));
    await act(async () => undefined);

    expect(factoryTargets(rig).filter((target) => target === DEV2)).toHaveLength(1);
  });

  it('unmounting the page stops the queue', async () => {
    const rig = makeRig();
    await signInThroughCallback(rig);
    await act(async () => rig.finishExchange(TOKEN_FROM_EXCHANGE));
    await waitFor(() => expect(rig.opens.has(DEV1)).toBe(true));

    cleanup();
    await act(async () => rig.opens.get(DEV1)!.reject(new TransportOpenError(FIRST_OPEN_FAILED, 'not found')));
    await act(async () => undefined);

    expect(factoryTargets(rig).filter((target) => target === DEV2)).toEqual([]);
  });
});

describe('finding 3: a closed remembered device offers Reconnect while signed in', () => {
  it('after an edit is cancelled, the device shows a Reconnect action that connects it', async () => {
    const rig = makeRig({ devices: [DEVICE1] });
    await signInThroughCallback(rig);
    await act(async () => rig.finishExchange(TOKEN_FROM_EXCHANGE));
    await waitFor(() => expect(rig.opens.has(DEV1)).toBe(true));
    // The first attempt fails, so the device is closed with a failure notice.
    await act(async () => rig.opens.get(DEV1)!.reject(new TransportOpenError(FIRST_OPEN_FAILED, 'not found')));
    await act(async () => undefined);

    // The user picks Choose a device and then cancels: the device is restored to its needs-sign-in state.
    act(() => {
      rig.hub.editDevice('d1');
      rig.hub.cancelEdit();
    });

    const main = within(screen.getByRole('main'));
    const reconnect = await main.findByRole('button', { name: 'Reconnect' });
    const before = factoryTargets(rig).filter((target) => target === DEV1).length;
    fireEvent.click(reconnect);
    expect(factoryTargets(rig).filter((target) => target === DEV1)).toHaveLength(before + 1);
    expect(factoryTargets(rig).at(-1)).toBe(DEV1);
  });
});

describe('finding 4: no Reconnect flicker between the token and the first automatic reconnect', () => {
  it('after a successful sign-in, no Reconnect action or Reconnect text appears before the first reconnect starts', async () => {
    const rig = makeRig({ devices: [DEVICE1] });
    await signInThroughCallback(rig);
    let connected = false;
    rig.factory.mockImplementation((target: string) => {
      connected = true;
      return controlledTransport(target, rig.opens);
    });
    // Every DOM change between the token and the first connect is inspected, as a browser would paint it.
    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      const text = document.body.textContent ?? '';
      if (!connected && /Reconnect|Sign in to reconnect/.test(text)) seen.push(text);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    await act(async () => rig.finishExchange(TOKEN_FROM_EXCHANGE));
    await waitFor(() => expect(connected).toBe(true));
    await act(async () => undefined);
    observer.disconnect();

    expect(seen).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });

  it('a device waiting behind another shows a quiet status and no Reconnect action', async () => {
    const rig = makeRig();
    await signInThroughCallback(rig);
    await act(async () => rig.finishExchange(TOKEN_FROM_EXCHANGE));
    await waitFor(() => expect(rig.opens.has(DEV1)).toBe(true));

    act(() => rig.hub.select('d2'));
    expect(await screen.findByText('Waiting to connect…')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    expect(factoryTargets(rig).filter((target) => target === DEV2)).toEqual([]);
  });

  it('after the queue settles with a failed connect, the device offers Reconnect', async () => {
    const rig = makeRig();
    await signInThroughCallback(rig);
    await act(async () => rig.finishExchange(TOKEN_FROM_EXCHANGE));
    await waitFor(() => expect(rig.opens.has(DEV1)).toBe(true));
    act(() => rig.hub.select('d2'));

    await act(async () => rig.opens.get(DEV1)!.reject(new TransportOpenError(FIRST_OPEN_FAILED, 'not found')));
    await waitFor(() => expect(factoryTargets(rig).filter((target) => target === DEV2)).toHaveLength(1));
    await act(async () => rig.opens.get(DEV2)!.reject(new TransportOpenError(FIRST_OPEN_FAILED, 'not found')));

    expect(await within(screen.getByRole('main')).findByRole('button', { name: 'Reconnect' })).toBeVisible();
    expect(screen.queryByText('Waiting to connect…')).toBeNull();
    expect(factoryTargets(rig).filter((target) => target === DEV2)).toHaveLength(1);
  });
});
