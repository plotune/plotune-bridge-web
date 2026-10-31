// Sign-in through plotune.net, end to end inside the app: the redirect, the return fragment, the automatic attempt on
// each load and its failure/sign-out flags, the token that stays in memory, and the account menu. Every page load is a fresh render with a
// fresh in-memory session; the browser-side storage and the fake fetch persist across renders, as they would in a tab.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { CloudError, type CloudClient, type CloudProject } from '../src/cloud/client';
import { SELECTED_PROJECT_KEY } from '../src/cloud/context';
import { createCloudSession, type CloudSession } from '../src/cloud/session';
import { PENDING_KEY, SIGNED_OUT_KEY, SILENT_FAILED_KEY } from '../src/cloud/sso';
import { DeviceHub } from '../src/state/hub';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { fakeSso, stateFromRedirect, type FakeSso } from './helpers/sso';

const BROWSER = { family: 'chromium', name: 'Chrome', supported: true } as const;
const CODE = 'c'.repeat(43);
const TOKEN = 'account-token-value-xyz';
const PROJECT: CloudProject = { id: 'proj-1', name: 'Lab', role: 'Owner' };
const AUTHORIZE = 'https://www.plotune.net/bridge/authorize';

interface Rig {
  client: CloudClient;
  sso: FakeSso;
  hub: DeviceHub;
  session: CloudSession;
}

/** The fake fetch and the browser storage outlive a page load; the in-memory session does not. */
function makeRig(options: { silentFailed?: boolean; client?: Partial<CloudClient>; origin?: string } = {}): Rig {
  const sso = fakeSso({ silentFailed: options.silentFailed, origin: options.origin });
  const client: CloudClient = {
    exchangeBridgeCode: vi.fn(async () => {
      sso.events.push(sso.state.hash === '' ? 'exchange' : 'exchange-with-fragment');
      return { accessToken: TOKEN, expiresIn: 28800, username: 'kantr' };
    }),
    listProjects: vi.fn(async () => [PROJECT]),
    listDevices: vi.fn(async () => []),
    createPairingToken: vi.fn(async () => ({ pairingToken: 'plt_pair_x', expiresAt: 0, expiresIn: 120 })),
    createBrowserTicket: vi.fn(async () => ({ ticket: 'ticket', expiresAt: 0 })),
    fetchIceServers: vi.fn(async () => ({ iceServers: [], expiresAt: 0 })),
    ...options.client,
  };
  const hub = new DeviceHub(
    () => new WorkspaceStore(defaultEnv({ transportFactory: vi.fn(), browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown' })),
    (fn) => fn(),
  );
  return { client, sso, hub, session: createCloudSession() };
}

/** A page load: a new session, the same hub, client and browser storage. */
function load(rig: Rig): void {
  cleanup();
  rig.session = createCloudSession();
  render(<App hub={rig.hub} browser={BROWSER} pageOrigin="https://bridge.plotune.net" cloudClient={rig.client} cloudSession={rig.session} cloudSso={rig.sso} />);
}

/** Simulates plotune.net sending the browser back with a fragment, then loads the page again. */
function returnWith(rig: Rig, params: Record<string, string>): void {
  rig.sso.state.hash = `#${new URLSearchParams(params).toString()}`;
  load(rig);
}

function pendingVerifier(rig: Rig): string {
  const raw = rig.sso.storage.data.get(PENDING_KEY);
  if (raw === undefined) throw new Error('nothing pending');
  return (JSON.parse(raw) as { verifier: string }).verifier;
}

const topbarSignIn = () => screen.getByRole('button', { name: 'Sign in' });

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('starting a sign-in', () => {
  it('the Sign in button sends the browser to plotune.net with a PKCE challenge and no prompt', async () => {
    const rig = makeRig();
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    const url = new URL(rig.sso.redirect.mock.calls[0][0]);
    expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE);
    expect(url.searchParams.has('prompt')).toBe(false);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const verifier = pendingVerifier(rig);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(url.searchParams.get('state')).toBe(JSON.parse(rig.sso.storage.data.get(PENDING_KEY)!).state);
  });

  it('keeps the verifier and state in sessionStorage only, never in localStorage', async () => {
    const rig = makeRig();
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalled());
    const verifier = pendingVerifier(rig);
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)!;
      expect(window.localStorage.getItem(key)).not.toContain(verifier);
    }
  });

  it('while the redirect is pending, the button reads Signing in and is disabled', async () => {
    const rig = makeRig();
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled());
  });

});

describe('the return from plotune.net', () => {
  it('exchanges the code with its verifier and signs in, with the fragment already gone', async () => {
    const rig = makeRig();
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalled());
    const verifier = pendingVerifier(rig);
    const state = stateFromRedirect(rig.sso);
    returnWith(rig, { code: CODE, state });
    expect(await screen.findByRole('button', { name: 'kantr' })).toBeVisible();
    expect(rig.client.exchangeBridgeCode).toHaveBeenCalledWith(CODE, verifier);
    // The fragment was removed before the exchange, and the code was exchanged exactly once.
    expect(rig.sso.events.filter((e) => e.startsWith('exchange'))).toEqual(['exchange']);
    expect(rig.sso.events.indexOf('clearHash')).toBeLessThan(rig.sso.events.indexOf('exchange'));
    expect(rig.sso.storage.data.has(PENDING_KEY)).toBe(false);
    expect(rig.session.getToken()).toBe(TOKEN);
  });

  it('a state that does not match discards the code: no exchange, neutral notice, nothing kept', async () => {
    const rig = makeRig();
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalled());
    returnWith(rig, { code: CODE, state: 'z'.repeat(22) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in could not be completed. Try again.');
    expect(rig.client.exchangeBridgeCode).not.toHaveBeenCalled();
    expect(rig.sso.storage.data.has(PENDING_KEY)).toBe(false);
    expect(rig.session.getToken()).toBeNull();
    expect(screen.queryByText(CODE)).toBeNull();
  });

  it('a 400 from the exchange says the sign-in expired, and signs nothing in', async () => {
    const rig = makeRig({ client: { exchangeBridgeCode: vi.fn(async () => { throw new CloudError('sign-in-expired'); }) } });
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalled());
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in expired. Try again.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  it('other exchange failures use the neutral message and never show the code or token', async () => {
    const rig = makeRig({ client: { exchangeBridgeCode: vi.fn(async () => { throw new CloudError('network'); }) } });
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalled());
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso) });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sign-in could not be completed. Try again.');
    expect(alert.textContent).not.toContain(CODE);
    expect(alert.textContent).not.toContain(TOKEN);
  });

  it('access_denied says the sign-in was cancelled', async () => {
    const rig = makeRig();
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalled());
    returnWith(rig, { error: 'access_denied', state: stateFromRedirect(rig.sso) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in was cancelled. Try again when you are ready.');
    expect(rig.client.exchangeBridgeCode).not.toHaveBeenCalled();
  });

  it('a valid code with nothing pending cannot be checked against a state, so it is never exchanged', async () => {
    const rig = makeRig();
    rig.sso.state.hash = `#code=${CODE}&state=${'q'.repeat(22)}`;
    load(rig);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in could not be completed. Try again.');
    expect(rig.client.exchangeBridgeCode).not.toHaveBeenCalled();
    expect(rig.sso.state.hash).toBe('');
  });

  it('a stray fragment with nothing pending is ignored quietly', async () => {
    const rig = makeRig();
    rig.sso.state.hash = '#hello=world';
    load(rig);
    await act(async () => undefined);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(rig.sso.state.hash).toBe('');
    expect(rig.client.exchangeBridgeCode).not.toHaveBeenCalled();
  });

  it('a malformed fragment is discarded with the pending pair, and the code is not used', async () => {
    const rig = makeRig();
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalled());
    returnWith(rig, { code: 'too-short', state: stateFromRedirect(rig.sso) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in could not be completed. Try again.');
    expect(rig.client.exchangeBridgeCode).not.toHaveBeenCalled();
    expect(rig.sso.storage.data.has(PENDING_KEY)).toBe(false);
  });

  it('Dismiss clears the notice', async () => {
    const rig = makeRig();
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalled());
    returnWith(rig, { code: CODE, state: 'z'.repeat(22) });
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the automatic attempt', () => {
  it('a first load with no session makes one prompt=none attempt, shown as Signing you in', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    expect(new URL(rig.sso.redirect.mock.calls[0][0]).searchParams.get('prompt')).toBe('none');
    expect(screen.getByText('Signing you in…')).toBeVisible();
    // Nothing is marked before the redirect: only the pending pair is written.
    expect(rig.sso.storage.writtenKeys).toEqual([PENDING_KEY]);
  });

  it('a reload after a successful sign-in makes a new automatic attempt', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso, 0) });
    await screen.findByRole('button', { name: 'kantr' });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(2));
    expect(new URL(rig.sso.redirect.mock.calls[1][0]).searchParams.get('prompt')).toBe('none');
  });

  it('after login_required, a reload makes no attempt', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { error: 'login_required', state: stateFromRedirect(rig.sso) });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Signing you in…')).toBeNull();
    expect(rig.sso.storage.data.get(SILENT_FAILED_KEY)).toBe('1');
    load(rig);
    await act(async () => undefined);
    expect(rig.sso.redirect).toHaveBeenCalledTimes(1);
  });

  it.each(['access_denied', 'server_error', 'invalid_request'])('after a %s return, a reload makes no attempt', async (error) => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { error, state: stateFromRedirect(rig.sso) });
    await screen.findByRole('button', { name: 'Sign in' });
    load(rig);
    await act(async () => undefined);
    expect(rig.sso.redirect).toHaveBeenCalledTimes(1);
  });

  it('a state mismatch and a failed exchange each also stop the automatic attempt', async () => {
    const mismatch = makeRig({ silentFailed: false });
    load(mismatch);
    await waitFor(() => expect(mismatch.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(mismatch, { code: CODE, state: 'z'.repeat(22) });
    await screen.findByRole('alert');
    load(mismatch);
    await act(async () => undefined);
    expect(mismatch.sso.redirect).toHaveBeenCalledTimes(1);

    const failedExchange = makeRig({ silentFailed: false, client: { exchangeBridgeCode: vi.fn(async () => { throw new CloudError('network'); }) } });
    load(failedExchange);
    await waitFor(() => expect(failedExchange.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(failedExchange, { code: CODE, state: stateFromRedirect(failedExchange.sso) });
    await screen.findByRole('alert');
    load(failedExchange);
    await act(async () => undefined);
    expect(failedExchange.sso.redirect).toHaveBeenCalledTimes(1);
  });

  it('a stale pending pair (an attempt that never came back) is cleared, marks the failure, and does not redirect', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    // The browser left plotune.net (back button, closed tab) and this page loads with no fragment.
    load(rig);
    await act(async () => undefined);
    expect(rig.sso.redirect).toHaveBeenCalledTimes(1);
    expect(rig.sso.storage.data.has(PENDING_KEY)).toBe(false);
    expect(rig.sso.storage.data.get(SILENT_FAILED_KEY)).toBe('1');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  it('an interactive Sign in after a failure clears the failure flag and redirects', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { error: 'login_required', state: stateFromRedirect(rig.sso) });
    await screen.findByRole('button', { name: 'Sign in' });
    expect(rig.sso.storage.data.get(SILENT_FAILED_KEY)).toBe('1');
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(2));
    expect(new URL(rig.sso.redirect.mock.calls[1][0]).searchParams.has('prompt')).toBe(false);
    expect(rig.sso.storage.data.has(SILENT_FAILED_KEY)).toBe(false);
  });

  it('Sign out still blocks the automatic attempt, after a successful sign-in has cleared the failure flag', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso, 0) });
    fireEvent.click(await screen.findByRole('button', { name: 'kantr' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(rig.sso.storage.data.get(SIGNED_OUT_KEY)).toBe('1');
    expect(rig.sso.storage.data.has(SILENT_FAILED_KEY)).toBe(false);
    load(rig);
    await act(async () => undefined);
    expect(rig.sso.redirect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  it('Sign out does not touch plotune.net', async () => {
    const rig = makeRig({ silentFailed: true });
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso) });
    fireEvent.click(await screen.findByRole('button', { name: 'kantr' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(rig.sso.redirect).toHaveBeenCalledTimes(1);
  });

  it('an explicit Sign in after Sign out clears the sign-out flag, so the user can sign in again', async () => {
    const rig = makeRig({ silentFailed: true });
    rig.sso.storage.setItem(SIGNED_OUT_KEY, '1');
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    expect(rig.sso.storage.data.has(SIGNED_OUT_KEY)).toBe(false);
  });

  it('the full sequence: automatic attempt, return with a code, token only in memory, reload, automatic attempt again', async () => {
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    const verifier = pendingVerifier(rig);
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso, 0) });
    await screen.findByRole('button', { name: 'kantr' });
    expect(rig.client.exchangeBridgeCode).toHaveBeenCalledWith(CODE, verifier);
    expect(rig.session.getToken()).toBe(TOKEN);
    expect(rig.sso.storage.data.has(SILENT_FAILED_KEY)).toBe(false);
    for (const value of [...rig.sso.storage.data.values(), ...Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.getItem(window.localStorage.key(i)!) ?? '')]) {
      expect(value).not.toContain(TOKEN);
      expect(value).not.toContain(CODE);
    }

    // Reload: the token was memory-only, so it is gone, and the page tries again on its own.
    load(rig);
    expect(rig.session.getToken()).toBeNull();
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(2));
    expect(new URL(rig.sso.redirect.mock.calls[1][0]).searchParams.get('prompt')).toBe('none');
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso, 1) });
    await screen.findByRole('button', { name: 'kantr' });
    expect(rig.client.exchangeBridgeCode).toHaveBeenCalledTimes(2);
  });

  it('with blocked session storage there is no automatic attempt, and Sign in says why it cannot continue', async () => {
    const rig = makeRig({ silentFailed: false });
    // The browser refuses sessionStorage: the hook reports no storage at all.
    rig.sso = { ...rig.sso, storage: null } as unknown as FakeSso;
    load(rig);
    await act(async () => undefined);
    expect(rig.sso.redirect).not.toHaveBeenCalled();
    fireEvent.click(topbarSignIn());
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in needs this tab to keep a little browser storage.');
    expect(rig.sso.redirect).not.toHaveBeenCalled();
  });
});


describe('the token and the code stay out of storage', () => {
  it('writes nothing but the sign-in flags, the pending pair and the selected project', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const rig = makeRig({ silentFailed: false });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    const verifier = pendingVerifier(rig);
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso) });
    await screen.findByRole('button', { name: 'kantr' });

    for (const [, value] of setItem.mock.calls) {
      expect(String(value)).not.toContain(TOKEN);
      expect(String(value)).not.toContain(CODE);
      expect(String(value)).not.toContain(verifier);
    }
    expect(new Set(setItem.mock.calls.map(([key]) => key))).toEqual(new Set([SELECTED_PROJECT_KEY]));
    expect(window.localStorage.getItem(SELECTED_PROJECT_KEY)).toBe(PROJECT.id);

    expect(new Set(rig.sso.storage.writtenKeys)).toEqual(new Set([PENDING_KEY]));
    for (const value of rig.sso.storage.data.values()) {
      expect(value).not.toContain(TOKEN);
      expect(value).not.toContain(CODE);
    }
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });
});

describe('origins other than bridge.plotune.net', () => {
  const LOCAL_ORIGINS = ['http://localhost:4173', 'http://127.0.0.1:4173', 'https://preview.bridge.example.test'];

  it.each(LOCAL_ORIGINS)('the automatic attempt does nothing on %s: no redirect, no storage writes, no reads of the flags', async (origin) => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const rig = makeRig({ silentFailed: false, origin });
    load(rig);
    await act(async () => undefined);
    expect(rig.sso.redirect).not.toHaveBeenCalled();
    expect(rig.sso.storage.writtenKeys).toEqual([]);
    expect(rig.sso.storage.data.size).toBe(0);
    expect(setItem).not.toHaveBeenCalled();
    expect(screen.queryByText('Signing you in…')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it.each(LOCAL_ORIGINS)('explicit Sign in on %s shows the local-network notice and does not redirect or store anything', async (origin) => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const rig = makeRig({ silentFailed: false, origin });
    load(rig);
    fireEvent.click(topbarSignIn());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in with a Plotune account works on bridge.plotune.net. On this address you can still connect to a device on your local network.',
    );
    expect(rig.sso.redirect).not.toHaveBeenCalled();
    expect(rig.sso.storage.writtenKeys).toEqual([]);
    expect(setItem).not.toHaveBeenCalled();
    // The button is not left stuck on "Signing in…".
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.queryByText('Signing you in…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Continue with Plotune on the local-network pane shows the same notice and does not redirect', async () => {
    const rig = makeRig({ silentFailed: false, origin: 'http://localhost:4173' });
    load(rig);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in and add a device' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Plotune' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in with a Plotune account works on bridge.plotune.net.');
    expect(rig.sso.redirect).not.toHaveBeenCalled();
    expect(rig.sso.storage.writtenKeys).toEqual([]);
  });

  it('the production origin still redirects with the automatic attempt and an explicit Sign in', async () => {
    const rig = makeRig({ silentFailed: false, origin: 'https://bridge.plotune.net' });
    load(rig);
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(1));
    expect(new URL(rig.sso.redirect.mock.calls[0][0]).searchParams.get('prompt')).toBe('none');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the account menu', () => {
  async function signedInRig(): Promise<Rig> {
    const rig = makeRig({ silentFailed: true });
    load(rig);
    fireEvent.click(topbarSignIn());
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalled());
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso) });
    await screen.findByRole('button', { name: 'kantr' });
    return rig;
  }

  it('signed out shows Sign in in the top bar', () => {
    const rig = makeRig({ silentFailed: true });
    load(rig);
    expect(topbarSignIn()).toBeEnabled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(rig.sso.redirect).not.toHaveBeenCalled();
  });

  it('signed in shows the username on a button that opens a menu with the three actions', async () => {
    await signedInRig();
    const trigger = screen.getByRole('button', { name: 'kantr' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(screen.getByText('Signed in as kantr')).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Switch account' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    const manage = screen.getByRole('menuitem', { name: 'Manage account on plotune.net' });
    expect(manage).toHaveAttribute('href', 'https://www.plotune.net/profile');
    expect(manage).toHaveAttribute('target', '_blank');
    expect(menu).toContainElement(manage);
    expect(screen.getByRole('menuitem', { name: 'Switch account' })).toHaveFocus();
  });

  it('Escape closes the menu and returns focus to the username button', async () => {
    await signedInRig();
    const trigger = screen.getByRole('button', { name: 'kantr' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Switch account' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('arrow keys move between the items', async () => {
    await signedInRig();
    fireEvent.click(screen.getByRole('button', { name: 'kantr' }));
    const first = screen.getByRole('menuitem', { name: 'Switch account' });
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Sign out' }), { key: 'ArrowUp' });
    expect(first).toHaveFocus();
  });

  it('a click outside closes the menu', async () => {
    await signedInRig();
    fireEvent.click(screen.getByRole('button', { name: 'kantr' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Switch account redirects with prompt=login', async () => {
    const rig = await signedInRig();
    fireEvent.click(screen.getByRole('button', { name: 'kantr' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch account' }));
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(2));
    expect(new URL(rig.sso.redirect.mock.calls[1][0]).searchParams.get('prompt')).toBe('login');
  });

  it('Sign out clears the account and the menu, and shows Sign in again', async () => {
    const rig = await signedInRig();
    fireEvent.click(screen.getByRole('button', { name: 'kantr' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(rig.session.getToken()).toBeNull();
    expect(screen.queryByText('kantr')).toBeNull();
  });

  it('a menu opened once does not reappear on its own after a later sign-in', async () => {
    const rig = await signedInRig();
    fireEvent.click(screen.getByRole('button', { name: 'kantr' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(rig.sso.redirect).toHaveBeenCalledTimes(2));
    returnWith(rig, { code: CODE, state: stateFromRedirect(rig.sso, 1) });
    await screen.findByRole('button', { name: 'kantr' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
