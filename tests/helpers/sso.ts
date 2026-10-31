// A fake browser sign-in hook: in-memory sessionStorage stand-in, a fragment that tests set, and a redirect that only
// records the URL (no navigation happens in jsdom).
import { vi } from 'vitest';
import { SILENT_FAILED_KEY, SSO_RETURN_ORIGIN, type SsoBrowser, type SsoStorage } from '../../src/cloud/sso';

export class MemoryStorage implements SsoStorage {
  readonly data = new Map<string, string>();
  /** Every key ever written with setItem, in order. */
  readonly writtenKeys: string[] = [];

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writtenKeys.push(key);
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

export interface FakeSso extends SsoBrowser {
  storage: MemoryStorage;
  /** The fragment the next page load sees. A test sets it and re-renders to simulate the return from plotune.net. */
  state: { hash: string };
  /** Ordered log of browser-side steps ('clearHash', 'redirect') and any the test adds (e.g. 'exchange'). */
  events: string[];
  redirect: ReturnType<typeof vi.fn<(url: string) => void>>;
  clearHash: ReturnType<typeof vi.fn<() => void>>;
}

/**
 * By default the automatic attempt counts as failed, so an App render does not redirect on its own. A test that wants the
 * automatic attempt on a load passes `silentFailed: false` (a fresh browser that has not failed yet).
 */
export function fakeSso(options: { hash?: string; silentFailed?: boolean; origin?: string } = {}): FakeSso {
  const storage = new MemoryStorage();
  if (options.silentFailed !== false) storage.setItem(SILENT_FAILED_KEY, '1');
  const state = { hash: options.hash ?? '' };
  const events: string[] = [];
  return {
    // The production origin unless a test says otherwise: that is where sign-in is supported.
    origin: options.origin ?? SSO_RETURN_ORIGIN,
    storage,
    state,
    events,
    readHash: () => state.hash,
    clearHash: vi.fn(() => {
      events.push('clearHash');
      state.hash = '';
    }),
    redirect: vi.fn<(url: string) => void>(() => {
      events.push('redirect');
    }),
  };
}

/** The state value in a redirect URL the page sent the browser to. */
export function stateFromRedirect(sso: FakeSso, call = 0): string {
  const url = sso.redirect.mock.calls[call]?.[0];
  if (url === undefined) throw new Error('no redirect was made');
  const value = new URL(url).searchParams.get('state');
  if (value === null) throw new Error('redirect has no state');
  return value;
}
