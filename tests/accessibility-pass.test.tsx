// Regression tests for the accessibility and usability pass (docs/ux-a11y-pass.md): landmarks, live regions, focus after
// state changes, the account menu's Tab, the phone touch sizes and the transmit form's aria references.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
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
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Plotune' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Plotune' }));
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
