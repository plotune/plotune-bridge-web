// Sign-in through plotune.net. The page sends the browser to plotune.net with a PKCE challenge; plotune.net sends it
// back here with a one-time code in the URL fragment, which is exchanged for the account token (see client.ts).
// The PKCE verifier and the state live in sessionStorage only until the callback uses them. The code, the token and
// the verifier are never written to localStorage. Nothing in this file touches the network.

export const PLOTUNE_AUTHORIZE_URL = 'https://www.plotune.net/bridge/authorize';
export const PENDING_KEY = 'bw.sso.pending';
/** Set when an automatic attempt failed (or a previous attempt never came back). Cleared by a successful sign-in or Sign in. */
export const SILENT_FAILED_KEY = 'bw.sso.silentFailed';
export const SIGNED_OUT_KEY = 'bw.sso.signedOut';

const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const CALLBACK_ERRORS = ['login_required', 'access_denied', 'invalid_request', 'server_error'] as const;

export type SignInPrompt = 'none' | 'login';
export type CallbackError = (typeof CALLBACK_ERRORS)[number];

export type CallbackResult = { kind: 'code'; code: string; state: string } | { kind: 'error'; error: CallbackError; state: string };

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export interface PendingSignIn {
  verifier: string;
  state: string;
}

/** The part of sessionStorage this module uses. Tests pass an in-memory stand-in. */
export type SsoStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Everything that touches the browser, so the provider can be driven without a real navigation. */
export interface SsoBrowser {
  /** sessionStorage, or null when the browser blocks it. Without it there can be no sign-in round trip. */
  storage: SsoStorage | null;
  /** The raw fragment, including the leading '#' when there is one. */
  readHash(): string;
  /** Removes the fragment from the address bar without a navigation. */
  clearHash(): void;
  redirect(url: string): void;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** A 16-byte random state: 22 characters of base64url. */
export function randomState(): string {
  return randomBase64url(16);
}

/** The S256 challenge for a verifier: base64url(SHA-256(verifier)), RFC 7636 section 4.2. */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** A 32-byte random PKCE verifier (43 characters) and its S256 challenge. */
export async function createPkce(): Promise<PkcePair> {
  const verifier = randomBase64url(32);
  return { verifier, challenge: await s256Challenge(verifier) };
}

export function buildAuthorizeUrl({ challenge, state, prompt }: { challenge: string; state: string; prompt?: SignInPrompt }): string {
  const url = new URL(PLOTUNE_AUTHORIZE_URL);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', state);
  if (prompt !== undefined) url.searchParams.set('prompt', prompt);
  return url.toString();
}

function isCallbackError(value: string): value is CallbackError {
  return (CALLBACK_ERRORS as readonly string[]).includes(value);
}

/**
 * Reads the fragment plotune.net sends back. Anything malformed returns null: a wrong length or charset, a repeated
 * key, a missing or ambiguous code/error, or an unknown error name. Unknown keys are ignored.
 */
export function parseCallbackHash(hash: string): CallbackResult | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return null;
  const values = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(raw)) {
    if (key !== 'code' && key !== 'state' && key !== 'error') continue;
    if (values.has(key)) return null;
    values.set(key, value);
  }
  const state = values.get('state');
  if (state === undefined || !STATE_PATTERN.test(state)) return null;
  const code = values.get('code');
  const error = values.get('error');
  if ((code === undefined) === (error === undefined)) return null;
  if (code !== undefined) return CODE_PATTERN.test(code) ? { kind: 'code', code, state } : null;
  if (error !== undefined && isCallbackError(error)) return { kind: 'error', error, state };
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stores the verifier and state for the round trip. Returns false when the browser will not keep them. */
export function savePending(storage: SsoStorage | null, pending: PendingSignIn): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(PENDING_KEY, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function readPending(storage: SsoStorage | null): PendingSignIn | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(PENDING_KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.verifier !== 'string' || typeof value.state !== 'string') return null;
    if (!CODE_PATTERN.test(value.verifier) || !STATE_PATTERN.test(value.state)) return null;
    return { verifier: value.verifier, state: value.state };
  } catch {
    return null;
  }
}

export function clearPending(storage: SsoStorage | null): void {
  try {
    storage?.removeItem(PENDING_KEY);
  } catch {
    // nothing stored, or storage blocked: nothing to remove
  }
}

function hasFlag(storage: SsoStorage | null, key: string): boolean {
  try {
    return storage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

function setFlag(storage: SsoStorage | null, key: string): boolean {
  try {
    storage?.setItem(key, '1');
    return storage !== null;
  } catch {
    return false;
  }
}

function clearFlag(storage: SsoStorage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // storage blocked: the flag cannot be set either
  }
}

/** True after an automatic (prompt=none) attempt failed in this tab: no further automatic attempts until Sign in. */
export function silentAttemptFailed(storage: SsoStorage | null): boolean {
  return hasFlag(storage, SILENT_FAILED_KEY);
}

export function markSilentFailed(storage: SsoStorage | null): boolean {
  return setFlag(storage, SILENT_FAILED_KEY);
}

export function clearSilentFailed(storage: SsoStorage | null): void {
  clearFlag(storage, SILENT_FAILED_KEY);
}

/** True after Sign out in this tab: the page must not sign the user back in silently. */
export function signedOutThisTab(storage: SsoStorage | null): boolean {
  return hasFlag(storage, SIGNED_OUT_KEY);
}

export function markSignedOutThisTab(storage: SsoStorage | null): void {
  setFlag(storage, SIGNED_OUT_KEY);
}

export function clearSignedOutThisTab(storage: SsoStorage | null): void {
  clearFlag(storage, SIGNED_OUT_KEY);
}

/** The real browser: sessionStorage (when not blocked), the address bar and location.assign. */
export function createBrowserSso(): SsoBrowser {
  let storage: SsoStorage | null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return {
    storage,
    readHash: () => window.location.hash,
    clearHash: () => {
      history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}`);
    },
    redirect: (url) => window.location.assign(url),
  };
}
