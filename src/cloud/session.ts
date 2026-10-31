// In-memory account session. The token lives only in this closure: it is never written to localStorage,
// sessionStorage, IndexedDB, cookies or the URL, so a page reload starts a new sign-in round trip.
// The JWT exp claim is read without verification, only to know when to forget the token. The server still
// decides whether a token is valid.

const MAX_TIMER_MS = 2 ** 31 - 1;

export interface CloudSession {
  getToken(): string | null;
  /** expiresAtSeconds (Unix time) is used when given; a JWT exp claim is used otherwise. The earlier one wins. */
  setToken(token: string, expiresAtSeconds?: number): void;
  clear(): void;
  /** Called after every change of the stored token. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Reads the exp claim of a JWT as milliseconds. Returns null for anything that is not a JWT with a numeric exp. */
export function jwtExpiryMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[1] === '') return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    if (typeof payload === 'object' && payload !== null && 'exp' in payload && typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
      return payload.exp * 1000;
    }
  } catch {
    // not a JWT payload: treated as a token without a known expiry
  }
  return null;
}

export function createCloudSession(): CloudSession {
  let token: string | null = null;
  let expiresAtMs: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // one failing listener must not keep the others from hearing about the change
      }
    }
  };

  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const forget = () => {
    const hadToken = token !== null;
    stopTimer();
    token = null;
    expiresAtMs = null;
    if (hadToken) notify();
  };

  // Timers cannot wait longer than MAX_TIMER_MS, so a far-off expiry re-checks when the timer fires.
  const schedule = () => {
    stopTimer();
    if (token === null || expiresAtMs === null) return;
    const remaining = Math.max(expiresAtMs - Date.now(), 0);
    timer = setTimeout(() => {
      timer = undefined;
      if (expiresAtMs !== null && Date.now() >= expiresAtMs) forget();
      else schedule();
    }, Math.min(remaining, MAX_TIMER_MS));
  };

  return {
    getToken() {
      if (token !== null && expiresAtMs !== null && Date.now() >= expiresAtMs) forget();
      return token;
    },

    setToken(next, expiresAtSeconds) {
      if (typeof next !== 'string' || next.length === 0) {
        forget();
        return;
      }
      const candidates = [jwtExpiryMs(next)];
      if (typeof expiresAtSeconds === 'number' && Number.isFinite(expiresAtSeconds)) candidates.push(expiresAtSeconds * 1000);
      const known = candidates.filter((value): value is number => value !== null);
      const nextExpiry = known.length > 0 ? Math.min(...known) : null;
      if (nextExpiry !== null && nextExpiry <= Date.now()) {
        forget();
        return;
      }
      stopTimer();
      token = next;
      expiresAtMs = nextExpiry;
      schedule();
      notify();
    },

    clear() {
      forget();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app-wide session. Tests and other callers should create their own with createCloudSession(). */
export const cloudSession: CloudSession = createCloudSession();
