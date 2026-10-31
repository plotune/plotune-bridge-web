// Regression tests for the accessibility and usability pass (docs/ux-a11y-pass.md): landmarks, live regions, focus after
// state changes, the account menu's Tab, the phone touch sizes and the transmit form's aria references.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { WORKSPACE_KEY, WorkspacePersistence } from '../src/state/persistence';
import { SignInPending } from '../src/components/SignInPending';
import { type CloudClient, type CloudDevice, type CloudProject, type PairingToken } from '../src/cloud/client';
import { createCloudSession, type CloudSession } from '../src/cloud/session';
import { DeviceHub } from '../src/state/hub';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { type DeviceTransport } from '../src/transport/types';
import { fakeSso, stateFromRedirect, type FakeSso } from './helpers/sso';

const BROWSER = { family: 'chromium', name: 'Chrome', supported: true } as const;
const CODE = 'c'.repeat(43);
const NOW_MS = Date.parse('2026-10-31T10:00:00Z');
const LAB: CloudProject = { id: 'proj-1', name: 'Lab', role: 'Owner' };
const BRIDGE_A: CloudDevice = { deviceUuid: 'dev-1', deviceId: 'Bridge-A', deviceType: 'bridge', pairedAt: new Date(NOW_MS - 3_600_000).toISOString() };

interface Rig {
  client: CloudClient;
  session: CloudSession;
  sso: FakeSso;
  hub: DeviceHub;
}

function pendingTransport(target: string): DeviceTransport {
  return { kind: 'fake', target, open: () => new Promise<void>(() => undefined), send: () => undefined, close: () => undefined, setListener: () => undefined };
}

function pairing(token: string): PairingToken {
  return { pairingToken: token, expiresAt: Math.floor(Date.now() / 1000) + 120, expiresIn: 120 };
}

function mount(rig: Rig): void {
  cleanup();
  rig.session = createCloudSession();
  render(<App hub={rig.hub} browser={BROWSER} pageOrigin="https://bridge.plotune.net" cloudClient={rig.client} cloudSession={rig.session} cloudSso={rig.sso} />);
}

function setup(): Rig {
  const client: CloudClient = {
    exchangeBridgeCode: vi.fn(async () => ({ accessToken: 'token', expiresIn: 28800, username: 'kantr' })),
    listProjects: vi.fn(async () => [LAB]),
    listDevices: vi.fn(async () => [BRIDGE_A] as CloudDevice[]),
    createPairingToken: vi.fn(async () => pairing('plt_pair_first')),
    createBrowserTicket: vi.fn(async () => ({ ticket: 'ticket', expiresAt: 0 })),
    fetchIceServers: vi.fn(async () => ({ iceServers: [], expiresAt: 0 })),
  };
  const transportFactory = vi.fn(pendingTransport);
  const hub = new DeviceHub(
    () => new WorkspaceStore(defaultEnv({ transportFactory, browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown', schedule: (fn) => fn(), slowConnectMs: 1e9 })),
    (fn) => fn(),
  );
  const rig: Rig = { client, session: createCloudSession(), sso: fakeSso(), hub };
  mount(rig);
  return rig;
}

/** Signs in the way the real flow does: Continue redirects, plotune.net returns a one-time code, the page loads again. */
async function signIn(rig: Rig): Promise<void> {
  const before = rig.sso.redirect.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plotune' }));
  await waitFor(() => expect(rig.sso.redirect.mock.calls.length).toBeGreaterThan(before));
  rig.sso.state.hash = `#code=${CODE}&state=${stateFromRedirect(rig.sso, rig.sso.redirect.mock.calls.length - 1)}`;
  mount(rig);
  await screen.findByText('Signed in');
}

async function openSignedIn(rig: Rig): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Add a device' }));
  await signIn(rig);
  await screen.findByText('Bridge-A');
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('landmarks and live regions', () => {
  it('the sign-in loading screen is the main landmark, so a screen reader user can jump to it', () => {
    render(<SignInPending onContinueWithout={() => undefined} />);
    expect(screen.getByRole('main')).toHaveAccessibleName('Plotune Bridge');
    expect(screen.getByRole('status')).toHaveTextContent('Signing you in with your Plotune account');
  });

  it('while signing in the workspace is replaced, so its Start capture control is not offered', async () => {
    const rig = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in and add a device' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Plotune' }));
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalled());
    expect(screen.getByRole('status')).toHaveTextContent('Signing you in');
    expect(screen.queryByRole('button', { name: 'Start capture' })).toBeNull();
  });

  it('a remote attempt has one live region (its status), not a live card around it', async () => {
    const rig = setup();
    await openSignedIn(rig);
    fireEvent.click(within(screen.getByRole('list', { name: 'Devices in this project' })).getByRole('button', { name: 'Connect' }));
    const card = await screen.findByTestId('connecting');
    expect(card).not.toHaveAttribute('aria-live');
    expect(within(card).getByRole('status')).toHaveTextContent('Contacting the Plotune cloud');
  });
});

describe('focus after a state change', () => {
  it('Connect in the device list moves focus to Cancel when the list is replaced, instead of losing it', async () => {
    const rig = setup();
    await openSignedIn(rig);
    const connect = within(screen.getByRole('list', { name: 'Devices in this project' })).getByRole('button', { name: 'Connect' });
    connect.focus();
    fireEvent.click(connect);
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
  });

  it('Cancel on a pairing code returns focus to Add a device, which is enabled again', async () => {
    const rig = setup();
    await openSignedIn(rig);
    const pane = within(screen.getByRole('main'));
    fireEvent.click(pane.getByRole('button', { name: 'Add a device' }));
    const group = await screen.findByRole('group', { name: 'Pairing code' });
    const cancel = within(group).getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.click(cancel);
    const add = pane.getByRole('button', { name: 'Add a device' });
    await waitFor(() => expect(add).toHaveFocus());
    expect(add).toBeEnabled();
  });

  it('opening the add-device pane from the empty workspace moves focus to its title, since that button is gone', () => {
    const rig = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in and add a device' }));
    expect(screen.getByRole('heading', { name: 'Sign in to connect your Bridge' })).toHaveFocus();
    expect(rig.sso.redirect).not.toHaveBeenCalled();
  });

  it('Sign out in the account menu moves focus to the Sign in button that replaces the menu', async () => {
    const rig = setup();
    await openSignedIn(rig);
    fireEvent.click(screen.getByRole('button', { name: 'kantr' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    const signIn = await screen.findByRole('button', { name: 'Sign in' });
    await waitFor(() => expect(signIn).toHaveFocus());
  });
});

describe('account menu keyboard', () => {
  it('Tab closes the menu and is not prevented, so focus moves on instead of being pulled back to the button', async () => {
    const rig = setup();
    await openSignedIn(rig);
    fireEvent.click(screen.getByRole('button', { name: 'kantr' }));
    const first = screen.getByRole('menuitem', { name: 'Switch account' });
    first.focus();
    const notPrevented = fireEvent.keyDown(first, { key: 'Tab' });
    expect(notPrevented).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape still closes the menu and returns focus to its button', async () => {
    const rig = setup();
    await openSignedIn(rig);
    const trigger = screen.getByRole('button', { name: 'kantr' });
    fireEvent.click(trigger);
    const first = screen.getByRole('menuitem', { name: 'Switch account' });
    first.focus();
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

describe('transmit form references', () => {
  it('no field points at an error message that is not on the page', () => {
    const hub = new DeviceHub(() => new WorkspaceStore(defaultEnv({ transportFactory: vi.fn(pendingTransport), browser: BROWSER, queryPermission: async () => 'unknown' })), (fn) => fn());
    render(<App hub={hub} browser={BROWSER} cloudSso={fakeSso()} />);
    expect(screen.getByLabelText('ID (hex)')).not.toHaveAttribute('aria-describedby');
    const dangling = [...document.querySelectorAll('[aria-describedby]')].filter((el) => !document.getElementById(el.getAttribute('aria-describedby') ?? ''));
    expect(dangling).toEqual([]);
  });
});

describe('touch sizes on phones', () => {
  it('the phone rule gives buttons, menu items, tabs and fields a 44 px minimum, and icon buttons 44 px wide', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'app.css'), 'utf8');
    const block = css.slice(css.lastIndexOf('@media (max-width: 640px) {'));
    expect(block).toMatch(/\.bw-button,[\s\S]*\.bw-icon-button,[\s\S]*\.bw-tabs button,[\s\S]*\.bw-account-menu-item,[\s\S]*\{\s*min-height: 44px;\s*\}/);
    expect(block).toMatch(/\.bw-button\.bw-small,/);
    expect(block).toMatch(/\.bw-button\.bw-small,/);
    expect(block).toMatch(/\.bw-icon-button \{\s*min-width: 44px;\s*\}/);
    expect(block).toMatch(/label:has\(> input\[type='checkbox'\]\) \{\s*min-height: 44px;/);
  });
});

describe('one h1 per screen, one wording for sign-in, and no raw remote address in the sidebar', () => {
  const h1Count = (): number => document.querySelectorAll('h1').length;

  it('the signed-out empty workspace has one h1, and the topbar brand is not a heading', () => {
    setup();
    expect(h1Count()).toBe(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Your workspace' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Plotune Bridge' })).toBeNull();
  });

  it('the add-device pane has one h1 while signed out, while signed in, and while connecting', async () => {
    const rig = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in and add a device' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to connect your Bridge' })).toBeVisible();
    expect(h1Count()).toBe(1);
    // The primary sign-in button has one wording in the pane.
    expect(screen.getByRole('button', { name: 'Sign in with Plotune' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue with Plotune' })).toBeNull();
    await signIn(rig);
    await screen.findByText('Bridge-A');
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Add a device' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Connect a Bridge device' })).toBeVisible();
    expect(h1Count()).toBe(1);
    fireEvent.click(within(screen.getByRole('list', { name: 'Devices in this project' })).getByRole('button', { name: 'Connect' }));
    const connecting = await screen.findByTestId('connecting');
    expect(within(connecting).getByRole('heading', { level: 1, name: 'Connecting' })).toBeVisible();
    expect(h1Count()).toBe(1);
  });

  it('signed in with no devices, the intro asks for a device and does not mention signing in', async () => {
    const rig = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in and add a device' }));
    await signIn(rig);
    // The sign-in leaves the pane open; leaving it shows the workspace intro a signed-in user sees.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const intro = await screen.findByTestId('empty-intro');
    expect(within(intro).getByRole('heading', { level: 1, name: 'Add your first device' })).toBeVisible();
    expect(intro).not.toHaveTextContent(/sign in/i);
    expect(within(intro).getByRole('button', { name: 'Add a device' })).toBeVisible();
    expect(within(intro).queryByRole('button', { name: 'Sign in and add a device' })).toBeNull();
    expect(h1Count()).toBe(1);
  });

  it('a workspace with a saved local device and no notice has one hidden h1 for the screen', () => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      version: 1, devices: [{ id: 'd2', label: 'Bridge 2', target: 'ws://192.168.1.50:9101', captureChannels: [1, 2], transmitChannel: 1 }],
      activeId: 'd2', traceView: 'all', page: 'capture', hidden: { capture: [], diagnostics: [], device: [] }, diagnostics: {}, permissionExplained: true,
    }));
    const hub = new DeviceHub(
      () => new WorkspaceStore(defaultEnv({ transportFactory: vi.fn(pendingTransport), browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown', schedule: (fn) => fn(), slowConnectMs: 1e9 })),
      (fn) => fn(),
      new WorkspacePersistence(),
    );
    render(<App hub={hub} browser={BROWSER} pageOrigin="https://bridge.plotune.net" cloudSso={fakeSso()} />);
    const h1s = document.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveClass('bw-sr-only');
    expect(h1s[0]).toHaveTextContent('Plotune Bridge workspace');
  });

  it('a remembered remote device in the sidebar shows a friendly name, not its remote:<project>/<device> address', () => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      version: 1, devices: [{ id: 'd1', label: 'Bridge 1', target: 'remote:proj_1/dev-1', captureChannels: [1, 2], transmitChannel: 1 }],
      activeId: 'd1', traceView: 'all', page: 'capture', hidden: { capture: [], diagnostics: [], device: [] }, diagnostics: {}, permissionExplained: true,
    }));
    // A page load restores the saved workspace, as the first-open tests do.
    const hub = new DeviceHub(
      () => new WorkspaceStore(defaultEnv({ transportFactory: vi.fn(pendingTransport), browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown', schedule: (fn) => fn(), slowConnectMs: 1e9 })),
      (fn) => fn(),
      new WorkspacePersistence(),
    );
    render(<App hub={hub} browser={BROWSER} pageOrigin="https://bridge.plotune.net" cloudSso={fakeSso({ silentFailed: true })} />);
    const sidebar = screen.getByRole('region', { name: 'Devices' });
    expect(sidebar).toHaveTextContent('Bridge 1');
    expect(sidebar).toHaveTextContent('Plotune cloud device');
    expect(sidebar.innerHTML).not.toContain('remote:');
  });
});
