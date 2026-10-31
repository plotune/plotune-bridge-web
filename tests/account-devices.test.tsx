// The account add-device pane, through the whole app: a fake cloud client, a fake browser sign-in hook (plotune.net is
// simulated by sending the browser back with a fragment) and a transport that never opens.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { CloudError, type CloudClient, type CloudDevice, type CloudProject, type PairingToken } from '../src/cloud/client';
import { SELECTED_PROJECT_KEY } from '../src/cloud/context';
import { createCloudSession, type CloudSession } from '../src/cloud/session';
import { DeviceHub } from '../src/state/hub';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { TransportOpenError, type DeviceTransport } from '../src/transport/types';
import { fakeSso, stateFromRedirect, type FakeSso } from './helpers/sso';

const BROWSER = { family: 'chromium', name: 'Chrome', supported: true } as const;
const TOKEN = 'account-token-value';
const CODE = 'c'.repeat(43);
const NOW_MS = Date.parse('2026-10-31T10:00:00Z');
const PAIRED_AT = new Date(NOW_MS - 3 * 3_600_000).toISOString();

const LAB: CloudProject = { id: 'proj-1', name: 'Lab', role: 'Owner' };
const FIELD: CloudProject = { id: 'proj-2', name: 'Field', role: 'Member' };
const BRIDGE_A: CloudDevice = { deviceUuid: 'dev-1', deviceId: 'Bridge-A', deviceType: 'bridge', pairedAt: PAIRED_AT };
const BRIDGE_B: CloudDevice = { deviceUuid: 'dev-2', deviceId: 'Bridge-B', deviceType: 'bridge', pairedAt: PAIRED_AT };

interface Options {
  projects?: CloudProject[];
  devices?: CloudDevice[];
  transportFactory?: (target: string) => DeviceTransport;
}

interface Rig {
  client: CloudClient;
  /** Replaced on every page load: the session is memory only. */
  session: CloudSession;
  sso: FakeSso;
  transportFactory: ReturnType<typeof vi.fn>;
  hub: DeviceHub;
  devices: { list: CloudDevice[] };
}

function pendingTransport(target: string): DeviceTransport {
  return { kind: 'fake', target, open: () => new Promise<void>(() => undefined), send: () => undefined, close: () => undefined, setListener: () => undefined };
}

function pairing(token: string, secondsFromNow = 120): PairingToken {
  return { pairingToken: token, expiresAt: Math.floor(Date.now() / 1000) + secondsFromNow, expiresIn: secondsFromNow };
}

/** A page load of the app with the rig's client, hub and browser sign-in hook. The session is new each time. */
function mount(rig: Rig): void {
  cleanup();
  rig.session = createCloudSession();
  render(<App hub={rig.hub} browser={BROWSER} pageOrigin="https://bridge.plotune.net" cloudClient={rig.client} cloudSession={rig.session} cloudSso={rig.sso} />);
}

function setup(options: Options = {}): Rig {
  const devices = { list: [...(options.devices ?? [BRIDGE_A])] };
  const client: CloudClient = {
    exchangeBridgeCode: vi.fn(async () => ({ accessToken: TOKEN, expiresIn: 28800, username: 'kantr' })),
    listProjects: vi.fn(async () => options.projects ?? [LAB]),
    listDevices: vi.fn(async () => [...devices.list]),
    createPairingToken: vi.fn(async () => pairing('plt_pair_first')),
    createBrowserTicket: vi.fn(async () => ({ ticket: 'ticket', expiresAt: 0 })),
    fetchIceServers: vi.fn(async () => ({ iceServers: [], expiresAt: 0 })),
  };
  const transportFactory = vi.fn(options.transportFactory ?? pendingTransport);
  const hub = new DeviceHub(
    () => new WorkspaceStore(defaultEnv({ transportFactory, browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown', schedule: (fn) => fn(), slowConnectMs: 1e9 })),
    (fn) => fn(),
  );
  const rig: Rig = { client, session: createCloudSession(), sso: fakeSso(), transportFactory, hub, devices };
  mount(rig);
  return rig;
}

function openAccountPane(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Add a device' }));
}

/**
 * Signs in the way the real flow does: the Continue button redirects to plotune.net, plotune.net sends the browser back
 * with a one-time code for the state it was given, and the page loads again with that fragment.
 */
async function signIn(rig: Rig): Promise<void> {
  const before = rig.sso.redirect.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plotune' }));
  await waitFor(() => expect(rig.sso.redirect.mock.calls.length).toBeGreaterThan(before));
  rig.sso.state.hash = `#code=${CODE}&state=${stateFromRedirect(rig.sso, rig.sso.redirect.mock.calls.length - 1)}`;
  mount(rig);
  await screen.findByText('Signed in');
}

/** Advances the fake clock (and the promises it resolves) by `ms`. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const pairPane = () => within(screen.getByRole('main'));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW_MS);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('signed-out view', () => {
  it('explains the sign-in on plotune.net, with one Continue button and a link to create an account', () => {
    const rig = setup();
    openAccountPane();
    expect(screen.getByRole('heading', { name: 'Sign in to connect your Bridge' })).toBeVisible();
    expect(screen.getByText(/Sign in with your Plotune account/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in with Plotune' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', 'https://www.plotune.net/register');
    expect(rig.sso.redirect).not.toHaveBeenCalled();
  });

  it('has no password or username field', () => {
    setup();
    openAccountPane();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByLabelText('Username or email')).toBeNull();
    expect(within(screen.getByRole('main')).queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('Sign in with Plotune sends the browser to plotune.net with no prompt', async () => {
    const rig = setup();
    openAccountPane();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plotune' }));
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    expect(new URL(rig.sso.redirect.mock.calls[0][0]).searchParams.has('prompt')).toBe(false);
  });

  it('the first-visit button "Sign in and add a device" opens the same pane with the Sign in with Plotune button', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Your workspace' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in and add a device' }));
    expect(screen.getByRole('heading', { name: /sign in to connect your bridge/i })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in with Plotune' })).toBeVisible();
  });
});

describe('signed-in account pane', () => {
  it('remembers the selected project and restores it on the next sign-in', async () => {
    window.localStorage.setItem(SELECTED_PROJECT_KEY, 'proj-2');
    const rig = setup({ projects: [LAB, FIELD], devices: [BRIDGE_B] });
    openAccountPane();
    await signIn(rig);
    expect(screen.getByLabelText('Project')).toHaveValue('proj-2');
    expect(rig.client.listDevices).toHaveBeenCalledWith(TOKEN, 'proj-2');
    expect(await screen.findByText('Bridge-B')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'proj-1' } });
    expect(window.localStorage.getItem(SELECTED_PROJECT_KEY)).toBe('proj-1');
  });

  it('preselects the only project and lists its devices', async () => {
    const rig = setup();
    openAccountPane();
    await signIn(rig);
    expect(screen.getByLabelText('Project')).toHaveValue('proj-1');
    expect(rig.client.listDevices).toHaveBeenCalledWith(TOKEN, 'proj-1');
    expect(await screen.findByText('Bridge-A')).toBeVisible();
    expect(screen.getByText(/Paired 3 hours ago/)).toBeVisible();
  });

  it('asks the user to choose when several projects are listed and none is remembered', async () => {
    const rig = setup({ projects: [LAB, FIELD] });
    openAccountPane();
    await signIn(rig);
    expect(screen.getByLabelText('Project')).toHaveValue('');
    expect(screen.queryByText('Bridge-A')).toBeNull();
  });

  it('says so when the account has no projects, with a link to create one', async () => {
    const rig = setup({ projects: [] });
    openAccountPane();
    await signIn(rig);
    expect(screen.getByText(/You have no projects yet/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'https://www.plotune.net/stream/workspace' })).toHaveAttribute('href', 'https://www.plotune.net/stream/workspace');
  });

  it('shows the empty device state for a project without devices', async () => {
    const rig = setup({ devices: [] });
    openAccountPane();
    await signIn(rig);
    expect(await screen.findByText('No devices paired to this project yet.')).toBeVisible();
  });

  it('Connect opens the remote target for exactly that device', async () => {
    const rig = setup();
    openAccountPane();
    await signIn(rig);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(rig.transportFactory).toHaveBeenCalledWith('remote:proj-1/dev-1');
  });

  it('shows a failed remote connection above the list, with a way to dismiss it', async () => {
    const rig = setup({
      transportFactory: (target) => ({
        ...pendingTransport(target),
        open: () => Promise.reject(new TransportOpenError({ phase: 'connecting', code: null, reason: 'not-found', wasClean: false, initiatedBy: 'local' }, 'not found')),
      }),
    });
    openAccountPane();
    await signIn(rig);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('This device is not paired to the project')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('This device is not paired to the project')).toBeNull();
    expect(rig.transportFactory).toHaveBeenCalledTimes(1);
  });

  it('the pane Sign out button clears the devices and shows the Continue button again', async () => {
    const rig = setup();
    openAccountPane();
    await signIn(rig);
    await screen.findByText('Bridge-A');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('heading', { name: 'Sign in to connect your Bridge' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in with Plotune' })).toBeVisible();
    expect(screen.queryByText('Bridge-A')).toBeNull();
    expect(rig.session.getToken()).toBeNull();
    expect(rig.sso.redirect).toHaveBeenCalledTimes(1);
  });

  it('an expired session returns the pane to the sign-in view', async () => {
    const rig = setup();
    openAccountPane();
    await signIn(rig);
    await screen.findByText('Bridge-A');
    act(() => rig.session.clear());
    expect(screen.getByRole('heading', { name: 'Sign in to connect your Bridge' })).toBeVisible();
    expect(screen.queryByText('Bridge-A')).toBeNull();
  });

  it('keeps the token and the code out of the page and out of storage', async () => {
    const rig = setup();
    openAccountPane();
    await signIn(rig);
    await screen.findByText('Bridge-A');
    const storage = [...Array(window.localStorage.length)].map((_, i) => window.localStorage.key(i)!).map((key) => window.localStorage.getItem(key) ?? '');
    for (const text of [document.body.innerHTML, ...storage, ...rig.sso.storage.data.values()]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(CODE);
    }
    expect(window.localStorage.getItem(SELECTED_PROJECT_KEY)).toBe('proj-1');
  });
});

describe('adding a device with a pairing code', () => {
  async function startPairing(rig: Rig): Promise<void> {
    await signIn(rig);
    await screen.findByText('Bridge-A');
    fireEvent.click(pairPane().getByRole('button', { name: 'Add a device' }));
    await screen.findByText('plt_pair_first');
  }

  it('does not start pairing until the existing devices have loaded, so one of them cannot finish the code', async () => {
    const rig = setup();
    let release: (devices: CloudDevice[]) => void = () => undefined;
    vi.mocked(rig.client.listDevices).mockImplementation(() => new Promise<CloudDevice[]>((resolve) => { release = resolve; }));
    openAccountPane();
    await signIn(rig);
    const add = pairPane().getByRole('button', { name: 'Add a device' });
    await waitFor(() => expect(add).toBeDisabled());
    fireEvent.click(add);
    expect(rig.client.createPairingToken).not.toHaveBeenCalled();
    await act(async () => release([BRIDGE_A]));
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await screen.findByText('plt_pair_first');
    // The device that was already paired is the baseline, not the result.
    await tick(3000);
    expect(screen.queryByText('Device added')).toBeNull();
    expect(screen.getByText('plt_pair_first')).toBeVisible();
  });

  it('lets the user retry a failed device list, and only then allows adding a device', async () => {
    const rig = setup();
    vi.mocked(rig.client.listDevices).mockRejectedValueOnce(new CloudError('network'));
    openAccountPane();
    await signIn(rig);
    const add = pairPane().getByRole('button', { name: 'Add a device' });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(add).toBeDisabled();
    fireEvent.click(retry);
    await screen.findByText('Bridge-A');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await waitFor(() => expect(add).toBeEnabled());
  });

  it('keeps detecting a new device when each device-list response takes longer than the poll interval', async () => {
    const rig = setup();
    await act(async () => undefined);
    openAccountPane();
    await signIn(rig);
    await screen.findByText('Bridge-A');
    let calls = 0;
    vi.mocked(rig.client.listDevices).mockImplementation(
      () => new Promise<CloudDevice[]>((resolve) => { calls += 1; setTimeout(() => resolve([BRIDGE_A, BRIDGE_B]), 4000); }),
    );
    fireEvent.click(pairPane().getByRole('button', { name: 'Add a device' }));
    await screen.findByText('plt_pair_first');
    await tick(3000);
    await tick(3000);
    await tick(3000);
    // One request ran at a time and its answer was applied rather than discarded by the next poll.
    expect(calls).toBeLessThanOrEqual(3);
    expect(await screen.findByText('Device added')).toBeVisible();
  });

  it('shows the one-time code with instructions and a countdown', async () => {
    const rig = setup();
    openAccountPane();
    await startPairing(rig);
    expect(screen.getByText('Enter this code on your Bridge device within 2 minutes.')).toBeVisible();
    expect(screen.getByText('Expires in 2:00')).toBeVisible();
    expect(rig.client.createPairingToken).toHaveBeenCalledWith(TOKEN, 'proj-1');
    await tick(1000);
    expect(screen.getByText('Expires in 1:59')).toBeVisible();
  });

  it('polls the device list while the code is active and reports a device that appears', async () => {
    const rig = setup();
    openAccountPane();
    await startPairing(rig);
    const before = vi.mocked(rig.client.listDevices).mock.calls.length;
    await tick(3000);
    expect(vi.mocked(rig.client.listDevices).mock.calls.length).toBeGreaterThan(before);
    expect(screen.queryByText('Device added')).toBeNull();
    rig.devices.list.push(BRIDGE_B);
    await tick(3000);
    expect(await screen.findByText('Device added')).toBeVisible();
    expect(screen.getByText('Bridge-B')).toBeVisible();
    // Once added, the list is no longer polled for this code.
    const settled = vi.mocked(rig.client.listDevices).mock.calls.length;
    await tick(9000);
    expect(vi.mocked(rig.client.listDevices).mock.calls.length).toBe(settled);
  });

  it('when the code expires, removes it and offers a new one', async () => {
    const rig = setup();
    openAccountPane();
    await startPairing(rig);
    // Built when the call happens: a code made at setup time would already be past its expiry by now.
    vi.mocked(rig.client.createPairingToken).mockImplementationOnce(async () => pairing('plt_pair_second'));
    await tick(121_000);
    expect(await screen.findByText('Code expired')).toBeVisible();
    expect(screen.queryByText('plt_pair_first')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Get a new code' }));
    expect(await screen.findByText('plt_pair_second')).toBeVisible();
  });

  it('cancel removes the code from view', async () => {
    const rig = setup();
    openAccountPane();
    await startPairing(rig);
    fireEvent.click(within(screen.getByRole('group', { name: 'Pairing code' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('plt_pair_first')).toBeNull();
    expect(pairPane().getByRole('button', { name: 'Add a device' })).toBeEnabled();
  });

  it('a project without owner or admin rights gets a clear message instead of a code', async () => {
    const rig = setup();
    rig.client.createPairingToken = vi.fn(async () => {
      throw new CloudError('forbidden');
    });
    mount(rig);
    openAccountPane();
    await signIn(rig);
    await screen.findByText('Bridge-A');
    fireEvent.click(pairPane().getByRole('button', { name: 'Add a device' }));
    expect(await screen.findByText('Only project owners and admins can add devices.')).toBeVisible();
    expect(screen.queryByText(/plt_pair_/)).toBeNull();
  });

  it('copies the code to the clipboard when asked', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const rig = setup();
    openAccountPane();
    await startPairing(rig);
    fireEvent.click(screen.getByRole('button', { name: 'Copy pairing code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('plt_pair_first'));
  });
});

describe('the local-network address stays available', () => {
  it('Advanced opens the address form with its placeholder, and the way back returns to the account', () => {
    setup();
    openAccountPane();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced: connect on the local network instead' }));
    if (screen.queryByTestId('permission-explainer')) fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByLabelText('Device address')).toHaveAttribute('placeholder', '192.168.1.50:9101');
    fireEvent.click(screen.getByRole('button', { name: 'Use my Plotune account' }));
    expect(screen.getByRole('heading', { name: 'Sign in to connect your Bridge' })).toBeVisible();
  });

  it('the first empty workspace offers one obvious way to sign in and add a device', async () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Your workspace' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in and add a device' }));
    expect(await screen.findByRole('heading', { name: /sign in to connect your bridge/i })).toBeVisible();
  });
});

describe('the project ID for the device setup page', () => {
  it('shows the project ID under the project choice, with its own copy button, when no pairing code is shown', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const rig = setup();
    openAccountPane();
    await signIn(rig);
    await screen.findByText('Bridge-A');
    expect(screen.getByText('proj-1', { selector: '.bw-mono' })).toBeVisible();
    const copy = screen.getByRole('button', { name: 'Copy project ID' });
    expect(copy.tagName).toBe('BUTTON');
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('proj-1'));
    expect(await screen.findByRole('button', { name: 'Copy project ID' })).toHaveTextContent('Copied');
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('while a pairing code is shown, the code card carries the project ID, the hint, and two distinctly named copy buttons', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const rig = setup();
    openAccountPane();
    await signIn(rig);
    await screen.findByText('Bridge-A');
    fireEvent.click(pairPane().getByRole('button', { name: 'Add a device' }));
    await screen.findByText('plt_pair_first');
    expect(screen.getByText('Enter this project ID and the code on your device.')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Copy project ID' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Copy pairing code' })).toHaveLength(1);
    expect(screen.queryByText(/^Project ID:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy project ID' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('proj-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy pairing code' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('plt_pair_first'));
    expect(writeText).toHaveBeenCalledTimes(2);
  });
});


describe('device list states for a paired device', () => {
  /** A transport that refuses to open with the reason a device that does not answer gives. */
  function unreachableTransport(target: string): DeviceTransport {
    return {
      ...pendingTransport(target),
      open: () => Promise.reject(new TransportOpenError({ phase: 'connecting', code: null, reason: 'device is not online', wasClean: false, initiatedBy: 'local' }, 'the device is not online')),
    };
  }

  async function listedRow(name = 'Bridge-A') {
    const list = await screen.findByRole('list', { name: 'Devices in this project' });
    return within(list).getByText(name).closest('li') as HTMLElement;
  }

  it('a device that did not answer shows "Not reachable" with the time, and its button reads Try again', async () => {
    const rig = setup({ transportFactory: unreachableTransport });
    openAccountPane();
    await signIn(rig);
    const list = await screen.findByRole('list', { name: 'Devices in this project' });
    fireEvent.click(within(list).getByRole('button', { name: 'Connect' }));
    expect(await within(await listedRow()).findByText(/Not reachable · tried just now/)).toBeVisible();
    expect(within(await listedRow()).getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(within(await listedRow()).queryByText(/Paired/)).toBeNull();
  });

  it('a cancelled attempt is not marked: the row is back to Paired with Connect', async () => {
    const rig = setup();
    openAccountPane();
    await signIn(rig);
    const list = await screen.findByRole('list', { name: 'Devices in this project' });
    fireEvent.click(within(list).getByRole('button', { name: 'Connect' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const row = await listedRow();
    expect(within(row).getByText(/Paired/)).toBeVisible();
    expect(within(row).getByRole('button', { name: 'Connect' })).toBeVisible();
    expect(screen.queryByText(/Not reachable/)).toBeNull();
  });

  it('the not-reachable mark is forgotten when the account signs out', async () => {
    const rig = setup({ transportFactory: unreachableTransport });
    openAccountPane();
    await signIn(rig);
    const list = await screen.findByRole('list', { name: 'Devices in this project' });
    fireEvent.click(within(list).getByRole('button', { name: 'Connect' }));
    expect(await within(await listedRow()).findByText(/Not reachable/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await signIn(rig);
    expect(within(await listedRow()).getByText(/Paired/)).toBeVisible();
    expect(screen.queryByText(/Not reachable/)).toBeNull();
  });
});
