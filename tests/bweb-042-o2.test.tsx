// BWEB-042 open item O2 — WCAG 2.4.6 / 2.4.9 (link and button purpose) and 2.5.3 (label in name).
// The account/device-list pane used to show several controls with the SAME accessible name: "Connect" once per device
// row, "Try again" in both a failure notice and a row, "Cancel" for pairing and for the pane, "Add a device" for the
// sidebar icon and the pane button, and "Sign out" in the account menu and in the pane. Each now keeps its visible
// label inside a longer, unique accessible name.
//
// These checks FAIL against the old markup: on every screen below, two or more controls with the same visible text
// shared one accessible name. We assert (1) the accessible names of all controls with the same visible text are
// unique where they co-exist, and (2) label-in-name holds: the accessible name contains the visible text.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { CloudError, type CloudClient, type CloudDevice, type CloudProject, type PairingToken } from '../src/cloud/client';
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
const BRIDGE_A: CloudDevice = { deviceUuid: 'dev-1', deviceId: 'Bridge-A', deviceType: 'bridge', pairedAt: PAIRED_AT };
const BRIDGE_B: CloudDevice = { deviceUuid: 'dev-2', deviceId: 'Bridge-B', deviceType: 'bridge', pairedAt: PAIRED_AT };
const ADVANCED = 'Advanced: connect on the local network instead';

/** Labels the audit found duplicated. */
const AMBIGUOUS = ['Connect', 'Try again', 'Cancel', 'Add a device', 'Sign out'];
const norm = (value: string | null): string => (value ?? '').replace(/\s+/g, ' ').trim();

interface Rig {
  client: CloudClient;
  session: CloudSession;
  sso: FakeSso;
  hub: DeviceHub;
  devices: { list: CloudDevice[] };
}

function pendingTransport(target: string): DeviceTransport {
  return { kind: 'fake', target, open: () => new Promise<void>(() => undefined), send: () => undefined, close: () => undefined, setListener: () => undefined };
}
function pairing(token: string, secondsFromNow = 120): PairingToken {
  return { pairingToken: token, expiresAt: Math.floor(Date.now() / 1000) + secondsFromNow, expiresIn: secondsFromNow };
}
function unreachableTransport(target: string): DeviceTransport {
  return {
    ...pendingTransport(target),
    open: () => Promise.reject(new TransportOpenError({ phase: 'connecting', code: null, reason: 'device is not online', wasClean: false, initiatedBy: 'local' }, 'no answer')),
  };
}

function mount(rig: Rig): void {
  cleanup();
  rig.session = createCloudSession();
  render(<App hub={rig.hub} browser={BROWSER} pageOrigin="https://bridge.plotune.net" cloudClient={rig.client} cloudSession={rig.session} cloudSso={rig.sso} />);
}

function setup(options: { devices?: CloudDevice[]; factory?: (target: string) => DeviceTransport } = {}): Rig {
  const devices = { list: [...(options.devices ?? [BRIDGE_A, BRIDGE_B])] };
  const client: CloudClient = {
    exchangeBridgeCode: vi.fn(async () => ({ accessToken: TOKEN, expiresIn: 28800, username: 'kantr' })),
    listProjects: vi.fn(async () => [LAB]),
    listDevices: vi.fn(async () => [...devices.list]),
    createPairingToken: vi.fn(async () => pairing('plt_pair_first')),
    createBrowserTicket: vi.fn(async () => ({ ticket: 'ticket', expiresAt: 0 })),
    fetchIceServers: vi.fn(async () => ({ iceServers: [], expiresAt: 0 })),
  };
  const transportFactory = vi.fn(options.factory ?? pendingTransport);
  const hub = new DeviceHub(
    () => new WorkspaceStore(defaultEnv({ transportFactory, browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown', schedule: (fn) => fn(), slowConnectMs: 1e9 })),
    (fn) => fn(),
  );
  const rig: Rig = { client, session: createCloudSession(), sso: fakeSso(), hub, devices };
  mount(rig);
  return rig;
}

async function signIn(rig: Rig): Promise<void> {
  const before = rig.sso.redirect.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plotune' }));
  await waitFor(() => expect(rig.sso.redirect.mock.calls.length).toBeGreaterThan(before));
  rig.sso.state.hash = `#code=${CODE}&state=${stateFromRedirect(rig.sso, rig.sso.redirect.mock.calls.length - 1)}`;
  mount(rig);
  await screen.findByText('Signed in');
}

/** Opens the add-device pane (the sidebar "+" button) and signs in. Callers wait for the state they want to inspect. */
async function signedInPane(rig: Rig): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Add a device' }));
  await signIn(rig);
}

/**
 * For each label in `expected`, gather every visible button/menuitem that either SHOWS that text or has that exact
 * accessible name (icon-only controls such as the sidebar "+" show no text but are named "Add a device"). Assert the
 * group really co-exists (so the check cannot pass vacuously), that all its accessible names are unique, and that each
 * name contains the visible text (label-in-name, WCAG 2.5.3).
 */
function assertUniqueAccessibleNames(label: string, expected: string[]): void {
  const controls = [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')]
    .filter((el) => el.closest('[hidden]') === null && !el.hasAttribute('aria-hidden'));
  const entries = controls.map((el) => ({ text: norm(el.textContent), name: norm(computeAccessibleName(el)) }));
  for (const visible of expected) {
    const group = entries.filter(({ text, name }) => text === visible || name === visible);
    expect(group.length, `${label}: expected two or more "${visible}" controls to co-exist`).toBeGreaterThanOrEqual(2);
    const names = group.map((g) => g.name);
    expect(new Set(names).size, `${label}: controls showing "${visible}" must have unique accessible names (got ${JSON.stringify(names)})`).toBe(names.length);
    for (const { text, name } of group) {
      if (text) expect(name, `${label}: label-in-name must hold for "${visible}"`).toContain(text);
    }
  }
  // Nothing outside the audit's five labels should have been left as a duplicate either.
  const allNames = controls.map((el) => norm(computeAccessibleName(el))).filter((n) => AMBIGUOUS.includes(n));
  const duplicates = allNames.filter((n, i) => allNames.indexOf(n) !== i);
  expect(duplicates, `${label}: no bare ambiguous accessible name should repeat`).toEqual([]);
}

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

describe('BWEB-042 O2: duplicate accessible names are resolved', () => {
  it('every device row names its device (Connect Bridge-A / Connect Bridge-B) and the pane Add a device is distinct', async () => {
    const rig = setup();
    await signedInPane(rig);
    await screen.findByText('Bridge-A');
    // The new, distinguishing names are what a test/assistive tech queries by role.
    expect(screen.getByRole('button', { name: 'Connect Bridge-A' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect Bridge-B' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add a device with a pairing code' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out of your Plotune account' })).toBeVisible();
    // No bare "Connect" is left on this screen (the local address form, where plain "Connect" is unambiguous, is elsewhere).
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
    assertUniqueAccessibleNames('device list / account pane', ['Connect', 'Add a device']);
  });

  it('opening the account menu keeps the menu Sign out and the pane Sign out distinguishable', async () => {
    const rig = setup();
    await signedInPane(rig);
    await screen.findByText('Bridge-A');
    fireEvent.click(screen.getByRole('button', { name: 'kantr' })); // open the account menu
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out of your Plotune account' })).toBeVisible();
    assertUniqueAccessibleNames('account pane + account menu open', ['Sign out', 'Connect', 'Add a device']);
  });

  it('a pairing code has a distinct Cancel from the pane Cancel, and the device rows still name their devices', async () => {
    const rig = setup({ devices: [BRIDGE_A, BRIDGE_B] });
    await signedInPane(rig);
    await screen.findByText('Bridge-A');
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Add a device with a pairing code' }));
    const group = await screen.findByRole('group', { name: 'Pairing code' });
    expect(within(group).getByRole('button', { name: 'Cancel pairing' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible(); // the pane cancel stays short
    assertUniqueAccessibleNames('pairing code screen', ['Cancel', 'Connect', 'Add a device']);
  });

  it('a failed connection shows a distinct "Try again" in the notice and in the device row', async () => {
    const rig = setup({ devices: [BRIDGE_A], factory: unreachableTransport });
    await signedInPane(rig);
    await screen.findByText('Bridge-A');
    fireEvent.click(within(screen.getByRole('list', { name: 'Devices in this project' })).getByRole('button', { name: 'Connect Bridge-A' }));
    await waitFor(() => expect(screen.queryByText(/Not reachable/)).not.toBeNull());
    // The notice keeps the plain "Try again"; the row names the device it retries.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again: reconnect Bridge-A' })).toBeVisible();
    assertUniqueAccessibleNames('unreachable-device failure notice', ['Try again', 'Add a device']);
  });

  it('a failed device-list load has its own "Try again" that names what it reloads', async () => {
    const rig = setup({ devices: [BRIDGE_A] });
    vi.mocked(rig.client.listDevices).mockRejectedValueOnce(new CloudError('network'));
    await signedInPane(rig);
    const retry = await screen.findByRole('button', { name: 'Try again: reload devices' });
    expect(retry).toBeVisible();
    expect(retry).toHaveTextContent('Try again'); // label-in-name: the visible label survives
  });

  it('plain copy is kept where a control is genuinely unambiguous (no invented rename)', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add a device' })); // open pane (signed out)
    fireEvent.click(screen.getByRole('button', { name: ADVANCED })); // local address form
    if (screen.queryByTestId('permission-explainer')) fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // One "Connect" (the address form) and one "Cancel" (the pane): both stay short, no distinguishing suffix.
    expect(screen.getByRole('button', { name: 'Connect' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Connect .+/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel pairing' })).toBeNull();
  });
});
