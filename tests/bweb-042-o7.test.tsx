// BWEB-042 / O7 (Doherty): "Sign in with Plotune" used to call window.location.assign() in the same task as
// setRedirecting(true), so React never painted the pending screen and the page looked frozen until plotune.net loaded.
// These tests pin the fix: an honest, announced pending state is on screen BEFORE redirect() is called, a small injected
// scheduler (stepped deterministically here) gates the navigation, and a refused or cancelled redirect recovers to the
// normal state instead of leaving a stuck spinner. The scheduler is injected through CloudProvider/App, so sso.ts (the
// sign-in protocol) is untouched.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { type CloudClient } from '../src/cloud/client';
import {
  SIGN_IN_NEEDS_STORAGE,
  SIGN_IN_NOT_COMPLETED,
  SIGN_IN_UNSUPPORTED_ORIGIN,
} from '../src/cloud/context';
import { type PaintScheduler } from '../src/cloud/paint';
import { SIGNING_IN_MESSAGE, TAKING_TO_PLOTUNE_MESSAGE } from '../src/components/SignInPending';
import { createCloudSession } from '../src/cloud/session';
import { DeviceHub } from '../src/state/hub';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { fakeSso, type FakeSso } from './helpers/sso';

const BROWSER = { family: 'chromium', name: 'Chrome', supported: true } as const;
const HOSTED = 'https://bridge.plotune.net';
const LOCAL = 'http://localhost:4178';

/** A paint scheduler the test steps by hand: afterPaint() stays pending until flush() lets the browser "paint". */
function manualPaint() {
  const waiting: Array<() => void> = [];
  const scheduler: PaintScheduler = {
    afterPaint: () => new Promise<void>((resolve) => { waiting.push(() => resolve()); }),
  };
  return {
    scheduler,
    /** How many paints are being awaited right now. */
    get pending(): number { return waiting.length; },
    /** Lets the pending screen paint and the redirect proceed. */
    flush: (): void => { for (const run of waiting.splice(0)) run(); },
  };
}

function client(): CloudClient {
  return {
    exchangeBridgeCode: vi.fn(async () => ({ accessToken: 'token', expiresIn: 28800, username: 'kantr' })),
    listProjects: vi.fn(async () => []),
    listDevices: vi.fn(async () => []),
    createPairingToken: vi.fn(async () => ({ pairingToken: 'p', expiresAt: 0, expiresIn: 120 })),
    createBrowserTicket: vi.fn(async () => ({ ticket: 't', expiresAt: 0 })),
    fetchIceServers: vi.fn(async () => ({ iceServers: [], expiresAt: 0 })),
  };
}

interface Mounted {
  sso: FakeSso;
  paint: ReturnType<typeof manualPaint>;
}

function mount(options: { silentFailed?: boolean; origin?: string; storageBlocked?: boolean; redirectThrows?: boolean } = {}): Mounted {
  const paint = manualPaint();
  const sso = fakeSso({ silentFailed: options.silentFailed ?? true, origin: options.origin ?? HOSTED });
  if (options.storageBlocked) (sso as unknown as { storage: null }).storage = null;
  if (options.redirectThrows) sso.redirect = vi.fn<(url: string) => void>(() => { throw new Error('navigation blocked'); });
  const hub = new DeviceHub(
    () => new WorkspaceStore(defaultEnv({ transportFactory: vi.fn(), browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown' })),
    (fn) => fn(),
  );
  cleanup();
  render(
    <App
      hub={hub}
      browser={BROWSER}
      pageOrigin={HOSTED}
      cloudClient={client()}
      cloudSession={createCloudSession()}
      cloudSso={sso}
      cloudPaintScheduler={paint.scheduler}
    />,
  );
  return { sso, paint };
}

const clickSignIn = () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe('BWEB-042 / O7: a real, announced pending state before the plotune.net redirect', () => {
  it('paints the honest "Taking you to Plotune to sign in…" status BEFORE redirect() is invoked', async () => {
    const { sso, paint } = mount();
    clickSignIn();
    // Let createPkce/savePending resolve and React commit the pending state — but do NOT step the paint scheduler.
    const status = await screen.findByText(TAKING_TO_PLOTUNE_MESSAGE);
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite'); // announced, not silent text
    expect(sso.redirect).not.toHaveBeenCalled();            // the paint comes before the navigation
    expect(paint.pending).toBe(1);                         // one paint is being awaited
    // Now let the browser paint: exactly one redirect to plotune.net follows.
    await act(async () => { paint.flush(); });
    await waitFor(() => expect(sso.redirect).toHaveBeenCalledTimes(1));
    const url = new URL(sso.redirect.mock.calls[0][0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://www.plotune.net/bridge/authorize');
    expect(url.searchParams.has('prompt')).toBe(false);
  });

  it('still makes exactly one prompt=none automatic attempt, after its paint', async () => {
    const { sso, paint } = mount({ silentFailed: false });
    // The automatic attempt keeps the original "Signing you in" copy; only an interactive click claims we are leaving.
    expect(screen.getByText(SIGNING_IN_MESSAGE)).toBeVisible();
    expect(sso.redirect).not.toHaveBeenCalled();
    // The automatic attempt reaches the paint step only after createPkce() resolves; wait for it before flushing.
    await waitFor(() => expect(paint.pending).toBe(1));
    await act(async () => { paint.flush(); });
    await waitFor(() => expect(sso.redirect).toHaveBeenCalledTimes(1));
    expect(new URL(sso.redirect.mock.calls[0][0]).searchParams.get('prompt')).toBe('none');
  });

  it('a refused redirect on an unsupported origin shows the honest notice, never a pending spinner', async () => {
    const { sso, paint } = mount({ origin: LOCAL });
    clickSignIn();
    expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_IN_UNSUPPORTED_ORIGIN);
    expect(sso.redirect).not.toHaveBeenCalled();
    expect(screen.queryByText(TAKING_TO_PLOTUNE_MESSAGE)).toBeNull();
    expect(screen.queryByText(SIGNING_IN_MESSAGE)).toBeNull();
    expect(paint.pending).toBe(0); // refused before a paint was ever awaited
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('a refused redirect with blocked storage shows the honest notice, never a pending spinner', async () => {
    const { sso, paint } = mount({ storageBlocked: true });
    clickSignIn();
    expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_IN_NEEDS_STORAGE);
    expect(sso.redirect).not.toHaveBeenCalled();
    expect(screen.queryByText(TAKING_TO_PLOTUNE_MESSAGE)).toBeNull();
    expect(screen.queryByText(SIGNING_IN_MESSAGE)).toBeNull();
    expect(paint.pending).toBe(0);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('when navigation cannot start, it recovers to the normal state with an honest notice, no stuck spinner', async () => {
    const { paint } = mount({ redirectThrows: true });
    clickSignIn();
    expect(await screen.findByText(TAKING_TO_PLOTUNE_MESSAGE)).toHaveAttribute('role', 'status');
    await waitFor(() => expect(paint.pending).toBe(1));
    await act(async () => { paint.flush(); });
    expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_IN_NOT_COMPLETED);
    expect(screen.queryByText(TAKING_TO_PLOTUNE_MESSAGE)).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
});
