// First open with a remembered remote device: the sign-in bounce is one calm state, a successful sign-in reconnects the
// remembered device exactly once, a failed or unavailable sign-in shows an informational card, and nothing else is started.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { CloudError, type CloudClient, type CloudDevice } from '../src/cloud/client';
import { createCloudSession, type CloudSession } from '../src/cloud/session';
import { PENDING_KEY, SIGNED_OUT_KEY, SILENT_FAILED_KEY } from '../src/cloud/sso';
import { SignInPending, CONTINUE_WITHOUT_MS, STILL_WORKING_MS } from '../src/components/SignInPending';
import { DeviceHub } from '../src/state/hub';
import { WORKSPACE_KEY, WorkspacePersistence, type SavedDevice } from '../src/state/persistence';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import type { DeviceTransport } from '../src/transport/types';
import { fakeSso, stateFromRedirect, type FakeSso } from './helpers/sso';

const BROWSER = { family: 'chromium', name: 'Chrome', supported: true } as const;
const CODE = 'c'.repeat(43);
const TOKEN = 'account-token-value-first-open';
const REMOTE = 'remote:proj_1/dev-1';
const LOCAL = 'ws://192.168.1.50:9101';
const REMEMBERED_REMOTE: SavedDevice = { id: 'd1', label: 'Bridge 1', target: REMOTE, captureChannels: [1, 2], transmitChannel: 1 };
const REMEMBERED_LOCAL: SavedDevice = { id: 'd2', label: 'Bridge 2', target: LOCAL, captureChannels: [1, 2], transmitChannel: 1 };
const CARD_TITLE = 'Sign in to connect to your device';
const SIGNING_IN_TEXT = 'Signing you in with your Plotune account…';

interface Rig {
  client: CloudClient;
  sso: FakeSso;
  transportFactory: ReturnType<typeof vi.fn<(target: string) => DeviceTransport>>;
  session: CloudSession;
  origin: string;
}

function pendingTransport(target: string): DeviceTransport {
  return { kind: 'fake', target, open: () => new Promise<void>(() => undefined), send: () => undefined, close: () => undefined, setListener: () => undefined };
}

/** The remembered devices are written the way the app writes them, then read back by a fresh hub on every page load. */
function seedWorkspace(devices: SavedDevice[]): void {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
    version: 1, devices, activeId: devices[0]?.id ?? '', traceView: 'all', page: 'capture',
    hidden: { capture: [], diagnostics: [], device: [] }, diagnostics: {}, permissionExplained: true,
  }));
}

function makeRig(options: { silentFailed?: boolean; origin?: string; client?: Partial<CloudClient>; devices?: SavedDevice[] } = {}): Rig {
  seedWorkspace(options.devices ?? [REMEMBERED_REMOTE]);
  const devices: CloudDevice[] = [];
  const client: CloudClient = {
    exchangeBridgeCode: vi.fn(async () => {
      rig.sso.events.push('exchange');
      return { accessToken: TOKEN, expiresIn: 28800, username: 'kantr' };
    }),
    listProjects: vi.fn(async () => [{ id: 'proj_1', name: 'Lab', role: 'Owner' }]),
    listDevices: vi.fn(async () => devices),
    createPairingToken: vi.fn(async () => ({ pairingToken: 'plt_pair_x', expiresAt: 0, expiresIn: 120 })),
    createBrowserTicket: vi.fn(async () => ({ ticket: 'ticket', expiresAt: 0 })),
    fetchIceServers: vi.fn(async () => ({ iceServers: [], expiresAt: 0 })),
    ...options.client,
  };
  const rig: Rig = {
    client,
    sso: fakeSso({ silentFailed: options.silentFailed, origin: options.origin }),
    transportFactory: vi.fn((target: string) => pendingTransport(target)),
    session: createCloudSession(),
    origin: options.origin ?? 'https://bridge.plotune.net',
  };
  return rig;
}

/** A page load: a fresh session and a hub restored from the saved workspace, as on a real reload. */
function load(rig: Rig): void {
  cleanup();
  rig.session = createCloudSession();
  const hub = new DeviceHub(
    () => new WorkspaceStore(defaultEnv({ transportFactory: rig.transportFactory, browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown', schedule: (fn) => fn(), slowConnectMs: 1e9 })),
    (fn) => fn(),
    new WorkspacePersistence(),
  );
  render(<App hub={hub} browser={BROWSER} pageOrigin={rig.origin} cloudClient={rig.client} cloudSession={rig.session} cloudSso={rig.sso} />);
}

function returnWith(rig: Rig, params: Record<string, string>): void {
  rig.sso.state.hash = `#${new URLSearchParams(params).toString()}`;
  load(rig);
}

const connectsTo = (rig: Rig, target: string) => rig.transportFactory.mock.calls.filter(([t]) => t === target).length;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the sign-in bounce on first open', () => {
  it('a remembered remote device with an automatic attempt pending shows only the sign-in state, with no notice and no workspace', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent(SIGNING_IN_TEXT);
    expect(screen.getByRole('heading', { name: 'Plotune Bridge' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(CARD_TITLE)).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Workspace' })).toBeNull();
    expect(rig.transportFactory).not.toHaveBeenCalled();
  });

  it('after the exchange succeeds, the remembered device connects exactly once, to its own target', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso) });
    await waitFor(() => expect(connectsTo(rig, REMOTE)).toBe(1));
    await act(async () => undefined);
    expect(rig.transportFactory).toHaveBeenCalledTimes(1);
    expect(rig.transportFactory.mock.calls[0][0]).toBe(REMOTE);
    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  });

  it('a signed-in page with a remembered device shows the workspace, not the add-device pane', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso) });
    await waitFor(() => expect(connectsTo(rig, REMOTE)).toBe(1));
    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Connect a Bridge device' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sign in to connect your Bridge' })).toBeNull();
    expect(screen.queryByText(CARD_TITLE)).toBeNull();
  });

  it('a reload after that sign-in makes one new attempt, and one more connect only after the next sign-in', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso, 0) });
    await waitFor(() => expect(connectsTo(rig, REMOTE)).toBe(1));

    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(2));
    expect(new URL(rig.sso.redirect.mock.calls[1][0]).searchParams.get('prompt')).toBe('none');
    // Still on the way back: nothing reconnects without a sign-in.
    expect(connectsTo(rig, REMOTE)).toBe(1);

    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso, 1) });
    await waitFor(() => expect(connectsTo(rig, REMOTE)).toBe(2));
    await act(async () => undefined);
    expect(connectsTo(rig, REMOTE)).toBe(2);
  });

  it('a remembered local device and any other device are never started by a sign-in', async () => {
    const rig = makeRig({ silentFailed: false, devices: [REMEMBERED_REMOTE, REMEMBERED_LOCAL] });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso) });
    await waitFor(() => expect(connectsTo(rig, REMOTE)).toBe(1));
    await act(async () => undefined);
    expect(connectsTo(rig, LOCAL)).toBe(0);
    expect(rig.transportFactory.mock.calls.map(([target]) => target)).toEqual([REMOTE]);
  });
});

describe('the informational sign-in card', () => {
  it('a failed automatic attempt shows the card, with no alert and no memory-only copy', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { error: 'login_required', state: stateFromRedirect(rig.sso) });
    expect(await screen.findByRole('heading', { name: CARD_TITLE })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/memory/i)).toBeNull();
    expect(screen.queryByText(/reload/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in with Plotune' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Use the local network instead' })).toBeVisible();
    expect(rig.transportFactory).not.toHaveBeenCalled();
  });

  it('a signed-out tab shows the card for the remembered device', async () => {
    const rig = makeRig({ silentFailed: true });
    load(rig);
    expect(await screen.findByRole('heading', { name: CARD_TITLE })).toBeVisible();
    expect(screen.queryByRole('status')).toBeNull();
    expect(rig.sso.redirect).not.toHaveBeenCalled();
  });

  it('the card sign-in button starts sign-in and does not open the add-device pane', async () => {
    const rig = makeRig({ silentFailed: true });
    load(rig);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Plotune' }));
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    expect(new URL(rig.sso.redirect.mock.calls[0][0]).searchParams.has('prompt')).toBe(false);
  });

  it('the local-network button opens the add-device pane straight in the local-network form', async () => {
    const rig = makeRig({ silentFailed: true });
    load(rig);
    fireEvent.click(await screen.findByRole('button', { name: 'Use the local network instead' }));
    expect(await screen.findByLabelText('Device address')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue with Plotune' })).toBeNull();
  });

  it('on an unsupported origin the card explains the local network and offers no redirect', async () => {
    const rig = makeRig({ silentFailed: false, origin: 'http://localhost:4173' });
    load(rig);
    expect(await screen.findByRole('heading', { name: CARD_TITLE })).toBeVisible();
    expect(screen.getByText(/works on bridge\.plotune\.net/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in with Plotune' })).toBeDisabled();
    expect(rig.sso.redirect).not.toHaveBeenCalled();
    expect(rig.sso.storage.writtenKeys).toEqual([]);
    expect(rig.transportFactory).not.toHaveBeenCalled();
  });
});

describe('the fallback on the sign-in state', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });

  it('"Continue without signing in" shows the workspace, marks the attempt failed, and leaves the card for the device', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Continue without signing in' })).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(CONTINUE_WITHOUT_MS);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue without signing in' }));
    expect(await screen.findByRole('navigation', { name: 'Workspace' })).toBeVisible();
    expect(screen.queryByRole('status')).toBeNull();
    expect(await screen.findByRole('heading', { name: CARD_TITLE })).toBeVisible();
    expect(rig.sso.storage.data.get(SILENT_FAILED_KEY)).toBe('1');
    expect(rig.sso.storage.data.has(PENDING_KEY)).toBe(false);
    expect(rig.transportFactory).not.toHaveBeenCalled();
  });
});

describe('the sign-in state', () => {
  it('shows the logo, the spinner line, and no "still working" line before 8 seconds', () => {
    vi.useFakeTimers();
    const { container } = render(<SignInPending onContinueWithout={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent(SIGNING_IN_TEXT);
    expect(container.querySelector('.bw-spinner')).not.toBeNull();
    expect(container.querySelector('img.bw-signing-in-logo')).not.toBeNull();
    expect(screen.queryByText(/Still working/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue without signing in' })).toBeNull();
    vi.useRealTimers();
  });

  it('adds the "still working" line at 8 seconds and the fallback button at 20 seconds', () => {
    vi.useFakeTimers();
    const onContinueWithout = vi.fn();
    render(<SignInPending onContinueWithout={onContinueWithout} />);
    act(() => {
      vi.advanceTimersByTime(STILL_WORKING_MS - 1);
    });
    expect(screen.queryByText(/Still working/)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Still working. This can take a few seconds on a slow connection.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue without signing in' })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(CONTINUE_WITHOUT_MS - STILL_WORKING_MS - 1);
    });
    expect(screen.queryByRole('button', { name: 'Continue without signing in' })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue without signing in' }));
    expect(onContinueWithout).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('clears both timers when it goes away, so nothing fires after the sign-in completes', () => {
    vi.useFakeTimers();
    const { unmount } = render(<SignInPending onContinueWithout={() => undefined} />);
    expect(vi.getTimerCount()).toBe(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('takes its timers from the injected object, so a test can drive them without the browser clock', () => {
    const scheduled: Array<{ fn: () => void; ms: number; id: number }> = [];
    const cleared: number[] = [];
    const timers = {
      setTimeout: (fn: () => void, ms: number) => {
        const id = scheduled.length + 1;
        scheduled.push({ fn, ms, id });
        return id;
      },
      clearTimeout: (id: unknown) => {
        cleared.push(id as number);
      },
    };
    const { unmount } = render(<SignInPending onContinueWithout={() => undefined} timers={timers} />);
    expect(scheduled.map((t) => t.ms)).toEqual([8000, 20000]);
    act(() => scheduled[0].fn());
    expect(screen.getByText(/Still working/)).toBeVisible();
    unmount();
    expect(cleared.sort()).toEqual([1, 2]);
  });
});

describe('the sign-in state and the card are never shown for a successful sign-in', () => {
  it('the card is not shown while the remembered device is reconnecting after the sign-in', async () => {
    const rig = makeRig({ silentFailed: false, client: { listProjects: vi.fn(async () => { throw new CloudError('network'); }) } });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso) });
    await waitFor(() => expect(connectsTo(rig, REMOTE)).toBe(1));
    expect(screen.queryByRole('heading', { name: CARD_TITLE })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('storage hygiene for the sign-in state', () => {
  it('a reload with a stale pending pair shows the card and makes no redirect', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    load(rig);
    expect(await screen.findByRole('heading', { name: CARD_TITLE })).toBeVisible();
    expect(rig.sso.redirect).toHaveBeenCalledTimes(1);
    expect(rig.sso.storage.data.has(PENDING_KEY)).toBe(false);
    expect(rig.sso.storage.data.get(SILENT_FAILED_KEY)).toBe('1');
    expect(rig.sso.storage.data.has(SIGNED_OUT_KEY)).toBe(false);
  });
});
