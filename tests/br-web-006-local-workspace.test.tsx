// BWEB-002 rev 1 / BR-WEB-006 rev 2: a loaded local workspace operates independently of Plotune Cloud.
// With the Cloud account signed out, the workspace still opens, can be edited, and its browser-owned
// state is not erased. L2 component level: the whole App is rendered with an in-memory account session.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { CloudClient } from '../src/cloud/client';
import { createCloudSession } from '../src/cloud/session';
import { DeviceHub } from '../src/state/hub';
import { WorkspacePersistence } from '../src/state/persistence';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { fakeSso } from './helpers/sso';

const BROWSER = { family: 'chromium', name: 'Chrome', supported: true } as const;
const ORIGIN = 'https://bridge.plotune.net';

function stubClient(): CloudClient {
  return {
    exchangeBridgeCode: vi.fn(async () => ({ accessToken: 'token', expiresIn: 3600, username: 'kantr' })),
    listProjects: vi.fn(async () => []),
    listDevices: vi.fn(async () => []),
    createPairingToken: vi.fn(async () => ({ pairingToken: 'plt_x', expiresAt: 0, expiresIn: 120 })),
    createBrowserTicket: vi.fn(async () => ({ ticket: 'ticket', expiresAt: 0 })),
    fetchIceServers: vi.fn(async () => ({ iceServers: [], expiresAt: 0 })),
  };
}

/** Every browser-owned `bw.*` preference, so a sign-out that clears any of them is detected. */
function localKeys(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith('bw.')) out[key] = window.localStorage.getItem(key);
  }
  return out;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('BWEB-002 r1 / BR-WEB-006 r2: local workspace independence', () => {
  it('after sign-out an existing local workspace opens, can be edited, and is not erased', async () => {
    // A page that was signed in (token in memory only). The fake SSO defaults to the production origin with
    // the automatic attempt marked failed, so no Cloud round trip happens on this render.
    const session = createCloudSession();
    session.setToken('account-token');
    const sso = fakeSso();
    const hub = new DeviceHub(
      () => new WorkspaceStore(defaultEnv({ transportFactory: vi.fn(), browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown' })),
      (fn) => fn(),
      new WorkspacePersistence(),
    );
    render(<App hub={hub} browser={BROWSER} pageOrigin={ORIGIN} cloudClient={stubClient()} cloudSession={session} cloudSso={sso} />);

    // The loaded local workspace is usable: its canvas navigation is present, not a sign-in screen.
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Canvases' })).toBeTruthy());
    const before = localKeys();
    expect(Object.keys(before).length).toBeGreaterThan(0); // the app has real local state to protect

    // Sign out (Cloud becomes unavailable / no account session).
    fireEvent.click(screen.getByRole('button', { name: 'Plotune account' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy());

    // The workspace is still open and no local preference was erased.
    expect(screen.getByRole('navigation', { name: 'Canvases' })).toBeTruthy();
    expect(localKeys()).toEqual(before);

    // It can still be edited locally (toggling the explorer writes bw.explorer), without any Cloud access.
    fireEvent.click(screen.getAllByRole('button', { name: /^Explorer$/ })[0]!);
    expect(window.localStorage.getItem('bw.explorer')).toBe('closed');
    for (const [key, value] of Object.entries(before)) expect(window.localStorage.getItem(key)).toBe(value);
  });
});
