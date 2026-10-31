// The account add-device pane, through the whole app: a fake cloud client, a fake session and a transport that never opens.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { CloudError, type CloudClient, type CloudDevice, type CloudProject, type PairingToken } from '../src/cloud/client';
import { createCloudSession, type CloudSession } from '../src/cloud/session';
import { SELECTED_PROJECT_KEY } from '../src/cloud/context';
import { DeviceHub } from '../src/state/hub';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { TransportOpenError, type DeviceTransport } from '../src/transport/types';

const BROWSER = { family: 'chromium', name: 'Chrome', supported: true } as const;
const TOKEN = 'account-token-value';
const PASSWORD = 'correct-horse-battery-staple';
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
  session: CloudSession;
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

function setup(options: Options = {}): Rig {
  const devices = { list: [...(options.devices ?? [BRIDGE_A])] };
  const client: CloudClient = {
    login: vi.fn(async () => ({ accessToken: TOKEN })),
    listProjects: vi.fn(async () => options.projects ?? [LAB]),
    listDevices: vi.fn(async () => [...devices.list]),
    createPairingToken: vi.fn(async () => pairing('plt_pair_first')),
    createBrowserTicket: vi.fn(async () => ({ ticket: 'ticket', expiresAt: 0 })),
    fetchIceServers: vi.fn(async () => ({ iceServers: [], expiresAt: 0 })),
  };
  const session = createCloudSession();
  const transportFactory = vi.fn(options.transportFactory ?? pendingTransport);
  const hub = new DeviceHub(
    () => new WorkspaceStore(defaultEnv({ transportFactory, browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown', schedule: (fn) => fn(), slowConnectMs: 1e9 })),
    (fn) => fn(),
  );
  render(<App hub={hub} browser={BROWSER} pageOrigin="https://bridge.plotune.net" cloudClient={client} cloudSession={session} />);
  return { client, session, transportFactory, hub, devices };
}

function openAccountPane(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Add a device' }));
}

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function signIn(user = 'kantr'): Promise<void> {
  fill('Username or email', user);
  fill('Password', PASSWORD);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
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

describe('signed-out sign-in form', () => {
  it('starts on the account pane with the sign-in form and a link to create an account', () => {
    setup();
    openAccountPane();
    expect(screen.getByRole('heading', { name: 'Sign in to connect your Bridge' })).toBeVisible();
    expect(screen.getByLabelText('Username or email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', 'https://www.plotune.net');
  });

  it('asks for both fields and never calls the cloud with an empty form', () => {
    const rig = setup();
    openAccountPane();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your username or email.')).toBeVisible();
    expect(screen.getByText('Enter your password.')).toBeVisible();
    expect(rig.client.login).not.toHaveBeenCalled();
  });

  it('signs in, preselects the only project and lists its devices', async () => {
    const rig = setup();
    openAccountPane();
    await signIn();
    expect(rig.client.login).toHaveBeenCalledWith('kantr', PASSWORD);
    expect(screen.getByLabelText('Project')).toHaveValue('proj-1');
    expect(rig.client.listDevices).toHaveBeenCalledWith(TOKEN, 'proj-1');
    expect(await screen.findByText('Bridge-A')).toBeVisible();
    expect(screen.getByText(/Paired 3 hours ago/)).toBeVisible();
  });

  it('clears the password as soon as it is submitted, while the sign-in is still pending', async () => {
    const rig = setup();
    let finish: (value: { accessToken: string }) => void = () => undefined;
    vi.mocked(rig.client.login).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    openAccountPane();
    fill('Username or email', 'kantr');
    fill('Password', PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    await act(async () => finish({ accessToken: TOKEN }));
    await screen.findByText('Signed in');
  });

  it.each([
    ['bad-credentials', 'The username or password is not correct.'],
    ['service-unavailable', 'Sign-in is temporarily unavailable, try again shortly.'],
    ['network', 'Could not reach Plotune. Check your connection and try again.'],
  ] as const)('explains a %s failure in plain words', async (code, message) => {
    const rig = setup();
    rig.client.login = vi.fn(async () => {
      throw new CloudError(code);
    });
    openAccountPane();
    fill('Username or email', 'kantr');
    fill('Password', PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Sign in to connect your Bridge' })).toBeVisible();
  });
});

describe('signed-in account pane', () => {
  it('remembers the selected project and restores it on the next sign-in', async () => {
    window.localStorage.setItem(SELECTED_PROJECT_KEY, 'proj-2');
    const rig = setup({ projects: [LAB, FIELD], devices: [BRIDGE_B] });
    openAccountPane();
    await signIn();
    expect(screen.getByLabelText('Project')).toHaveValue('proj-2');
    expect(rig.client.listDevices).toHaveBeenCalledWith(TOKEN, 'proj-2');
    expect(await screen.findByText('Bridge-B')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'proj-1' } });
    expect(window.localStorage.getItem(SELECTED_PROJECT_KEY)).toBe('proj-1');
  });

  it('asks the user to choose when several projects are listed and none is remembered', async () => {
    setup({ projects: [LAB, FIELD] });
    openAccountPane();
    await signIn();
    expect(screen.getByLabelText('Project')).toHaveValue('');
    expect(screen.queryByText('Bridge-A')).toBeNull();
  });

  it('says so when the account has no projects, with a link to create one', async () => {
    setup({ projects: [] });
    openAccountPane();
    await signIn();
    expect(screen.getByText(/You have no projects yet/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'https://www.plotune.net/stream/workspace' })).toHaveAttribute('href', 'https://www.plotune.net/stream/workspace');
  });

  it('shows the empty device state for a project without devices', async () => {
    setup({ devices: [] });
    openAccountPane();
    await signIn();
    expect(await screen.findByText('No devices paired to this project yet.')).toBeVisible();
  });

  it('Connect opens the remote target for exactly that device', async () => {
    const rig = setup();
    openAccountPane();
    await signIn();
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
    await signIn();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('This device is not paired to the project')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('This device is not paired to the project')).toBeNull();
    expect(rig.transportFactory).toHaveBeenCalledTimes(1);
  });

  it('sign out clears the devices and shows the sign-in form again', async () => {
    setup();
    openAccountPane();
    await signIn();
    await screen.findByText('Bridge-A');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('heading', { name: 'Sign in to connect your Bridge' })).toBeVisible();
    expect(screen.queryByText('Bridge-A')).toBeNull();
  });

  it('an expired session returns the pane to the sign-in form', async () => {
    const rig = setup();
    openAccountPane();
    await signIn();
    await screen.findByText('Bridge-A');
    act(() => rig.session.clear());
    expect(screen.getByRole('heading', { name: 'Sign in to connect your Bridge' })).toBeVisible();
    expect(screen.queryByText('Bridge-A')).toBeNull();
  });

  it('keeps the token and the password out of the page and out of storage', async () => {
    setup();
    openAccountPane();
    await signIn();
    await screen.findByText('Bridge-A');
    const storage = [...Array(window.localStorage.length)].map((_, i) => window.localStorage.key(i)!).map((key) => window.localStorage.getItem(key) ?? '');
    for (const text of [document.body.innerHTML, ...storage]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(PASSWORD);
    }
    expect(window.localStorage.getItem(SELECTED_PROJECT_KEY)).toBe('proj-1');
  });
});

describe('adding a device with a pairing code', () => {
  async function startPairing(): Promise<void> {
    await signIn();
    await screen.findByText('Bridge-A');
    fireEvent.click(pairPane().getByRole('button', { name: 'Add a device' }));
    await screen.findByText('plt_pair_first');
  }

  it('shows the one-time code with instructions and a countdown', async () => {
    const rig = setup();
    openAccountPane();
    await startPairing();
    expect(screen.getByText('Enter this code on your Bridge device within 2 minutes.')).toBeVisible();
    expect(screen.getByText('Expires in 2:00')).toBeVisible();
    expect(rig.client.createPairingToken).toHaveBeenCalledWith(TOKEN, 'proj-1');
    await tick(1000);
    expect(screen.getByText('Expires in 1:59')).toBeVisible();
  });

  it('polls the device list while the code is active and reports a device that appears', async () => {
    const rig = setup();
    openAccountPane();
    await startPairing();
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
    await startPairing();
    // Built when the call happens: a code made at setup time would already be past its expiry by now.
    vi.mocked(rig.client.createPairingToken).mockImplementationOnce(async () => pairing('plt_pair_second'));
    await tick(121_000);
    expect(await screen.findByText('Code expired')).toBeVisible();
    expect(screen.queryByText('plt_pair_first')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Get a new code' }));
    expect(await screen.findByText('plt_pair_second')).toBeVisible();
  });

  it('cancel removes the code from view', async () => {
    setup();
    openAccountPane();
    await startPairing();
    fireEvent.click(within(screen.getByRole('group', { name: 'Pairing code' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('plt_pair_first')).toBeNull();
    expect(pairPane().getByRole('button', { name: 'Add a device' })).toBeEnabled();
  });

  it('a project without owner or admin rights gets a clear message instead of a code', async () => {
    const rig = setup();
    rig.client.createPairingToken = vi.fn(async () => {
      throw new CloudError('forbidden');
    });
    openAccountPane();
    await signIn();
    await screen.findByText('Bridge-A');
    fireEvent.click(pairPane().getByRole('button', { name: 'Add a device' }));
    expect(await screen.findByText('Only project owners and admins can add devices.')).toBeVisible();
    expect(screen.queryByText(/plt_pair_/)).toBeNull();
  });

  it('copies the code to the clipboard when asked', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    setup();
    openAccountPane();
    await startPairing();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('plt_pair_first'));
  });
});

describe('the local-network address stays available', () => {
  it('Advanced opens the address form with its placeholder, and the way back returns to the account', async () => {
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
