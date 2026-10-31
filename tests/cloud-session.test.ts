import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudSession, jwtExpiryMs } from '../src/cloud/session';

const NOW = Date.parse('2026-10-31T12:00:00Z');

/** Builds an unsigned JWT-shaped token. The session never verifies signatures, so none is needed. */
function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.c2lnbmF0dXJl`;
}

describe('cloud session', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts empty and keeps the token it is given', () => {
    const session = createCloudSession();
    expect(session.getToken()).toBeNull();
    session.setToken('opaque-token');
    expect(session.getToken()).toBe('opaque-token');
    session.clear();
    expect(session.getToken()).toBeNull();
  });

  it('a non-JWT token is stored without an expiry and never auto-clears', () => {
    const session = createCloudSession();
    session.setToken('not-a-jwt');
    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);
    expect(session.getToken()).toBe('not-a-jwt');
  });

  it('auto-clears at the JWT exp claim and tells subscribers', () => {
    const session = createCloudSession();
    const listener = vi.fn();
    session.subscribe(listener);
    session.setToken(jwt({ sub: 'acct', exp: NOW / 1000 + 60 }));
    expect(listener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(59_000);
    expect(session.getToken()).not.toBeNull();

    vi.advanceTimersByTime(2_000);
    expect(session.getToken()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('a JWT that is already expired is not stored', () => {
    const session = createCloudSession();
    session.setToken(jwt({ exp: NOW / 1000 - 1 }));
    expect(session.getToken()).toBeNull();
  });

  it('getToken drops an expired token even if the timer has not run', () => {
    const session = createCloudSession();
    session.setToken('plain', NOW / 1000 + 10);
    vi.setSystemTime(NOW + 10_000);
    expect(session.getToken()).toBeNull();
  });

  it('an explicit expiry in seconds is used, and the earlier of it and the JWT exp wins', () => {
    const session = createCloudSession();
    session.setToken(jwt({ exp: NOW / 1000 + 3600 }), NOW / 1000 + 30);
    vi.advanceTimersByTime(31_000);
    expect(session.getToken()).toBeNull();
  });

  it('ignores a non-finite explicit expiry', () => {
    const session = createCloudSession();
    session.setToken('plain', Number.NaN);
    vi.advanceTimersByTime(10 * 365 * 24 * 60 * 60 * 1000);
    expect(session.getToken()).toBe('plain');
  });

  it('re-checks far-off expiries instead of waiting past the timer limit', () => {
    const session = createCloudSession();
    const exp = NOW / 1000 + 40 * 24 * 60 * 60;
    session.setToken(jwt({ exp }));
    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
    expect(session.getToken()).not.toBeNull();
    vi.advanceTimersByTime(11 * 24 * 60 * 60 * 1000);
    expect(session.getToken()).toBeNull();
  });

  it('a replaced token gets its own expiry', () => {
    const session = createCloudSession();
    session.setToken(jwt({ exp: NOW / 1000 + 10 }));
    session.setToken(jwt({ exp: NOW / 1000 + 600 }));
    vi.advanceTimersByTime(20_000);
    expect(session.getToken()).not.toBeNull();
  });

  it('an empty token clears the session', () => {
    const session = createCloudSession();
    session.setToken('abc');
    session.setToken('');
    expect(session.getToken()).toBeNull();
  });

  it('subscribe returns an unsubscribe that stops notifications', () => {
    const session = createCloudSession();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    session.setToken('one');
    unsubscribe();
    session.setToken('two');
    session.clear();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clear notifies only when there was a token, and one failing listener does not block the others', () => {
    const session = createCloudSession();
    const broken = vi.fn(() => {
      throw new Error('listener failure');
    });
    const healthy = vi.fn();
    session.subscribe(broken);
    session.subscribe(healthy);
    session.clear();
    expect(healthy).not.toHaveBeenCalled();
    session.setToken('one');
    expect(healthy).toHaveBeenCalledTimes(1);
    session.clear();
    expect(healthy).toHaveBeenCalledTimes(2);
  });

  it('clear stops a pending expiry timer', () => {
    const session = createCloudSession();
    const listener = vi.fn();
    session.setToken(jwt({ exp: NOW / 1000 + 60 }));
    session.subscribe(listener);
    session.clear();
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('never touches localStorage, sessionStorage or cookies', () => {
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');
    const setSession = vi.spyOn(Storage.prototype, 'getItem');
    const cookieBefore = document.cookie;
    const session = createCloudSession();
    session.setToken(jwt({ exp: NOW / 1000 + 600 }));
    session.getToken();
    session.clear();
    session.setToken('plain-token');
    expect(setLocal).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe(cookieBefore);
  });
});

describe('jwtExpiryMs', () => {
  it('reads a numeric exp claim in milliseconds from a base64url payload', () => {
    expect(jwtExpiryMs(jwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
  });

  it('returns null for anything that is not a JWT with a numeric exp', () => {
    expect(jwtExpiryMs('plain-token')).toBeNull();
    expect(jwtExpiryMs('a.b')).toBeNull();
    expect(jwtExpiryMs('a..c')).toBeNull();
    expect(jwtExpiryMs('a.!!!.c')).toBeNull();
    expect(jwtExpiryMs(`x.${Buffer.from('"just a string"').toString('base64url')}.y`)).toBeNull();
    expect(jwtExpiryMs(jwt({ exp: 'soon' }))).toBeNull();
    expect(jwtExpiryMs(jwt({ sub: 'no-exp' }))).toBeNull();
  });
});
