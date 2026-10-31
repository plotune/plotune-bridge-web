// Pure sign-in helpers: PKCE, the authorize URL, the fragment parser and the sessionStorage bookkeeping. No network.
import { describe, expect, it, vi } from 'vitest';
import {
  PENDING_KEY,
  SIGNED_OUT_KEY,
  SILENT_FAILED_KEY,
  buildAuthorizeUrl,
  clearPending,
  clearSilentFailed,
  createPkce,
  markSignedOutThisTab,
  markSilentFailed,
  parseCallbackHash,
  randomState,
  readPending,
  s256Challenge,
  savePending,
  signedOutThisTab,
  silentAttemptFailed,
  SSO_RETURN_ORIGIN,
  ssoSupported,
  type SsoStorage,
} from '../src/cloud/sso';
import { MemoryStorage } from './helpers/sso';

const CODE = 'a'.repeat(43);
const STATE = 'b'.repeat(22);
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function throwingStorage(): SsoStorage {
  const fail = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

describe('PKCE', () => {
  it('derives the RFC 7636 appendix B challenge from its verifier', async () => {
    expect(await s256Challenge(VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it('makes a 43-character verifier and a 43-character challenge that matches it', async () => {
    const { verifier, challenge } = await createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(await s256Challenge(verifier));
  });

  it('makes a different verifier every time', async () => {
    const a = await createPkce();
    const b = await createPkce();
    expect(a.verifier).not.toBe(b.verifier);
  });

  it('makes a 22-character state each time', () => {
    const state = randomState();
    expect(state).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomState()).not.toBe(state);
  });
});

describe('buildAuthorizeUrl', () => {
  const base = 'https://www.plotune.net/bridge/authorize';

  it('has no prompt for the interactive sign-in', () => {
    const url = buildAuthorizeUrl({ challenge: RFC_CHALLENGE, state: STATE });
    expect(url).toBe(`${base}?code_challenge=${RFC_CHALLENGE}&state=${STATE}`);
    expect(new URL(url).searchParams.has('prompt')).toBe(false);
  });

  it('adds prompt=none for the silent attempt', () => {
    expect(buildAuthorizeUrl({ challenge: RFC_CHALLENGE, state: STATE, prompt: 'none' })).toBe(`${base}?code_challenge=${RFC_CHALLENGE}&state=${STATE}&prompt=none`);
  });

  it('adds prompt=login for Switch account', () => {
    expect(buildAuthorizeUrl({ challenge: RFC_CHALLENGE, state: STATE, prompt: 'login' })).toBe(`${base}?code_challenge=${RFC_CHALLENGE}&state=${STATE}&prompt=login`);
  });
});

describe('parseCallbackHash', () => {
  it('reads a success fragment, with or without the leading #', () => {
    const expected = { kind: 'code', code: CODE, state: STATE };
    expect(parseCallbackHash(`#code=${CODE}&state=${STATE}`)).toEqual(expected);
    expect(parseCallbackHash(`code=${CODE}&state=${STATE}`)).toEqual(expected);
  });

  it('reads each failure the authorize endpoint can report', () => {
    for (const error of ['login_required', 'access_denied', 'invalid_request', 'server_error']) {
      expect(parseCallbackHash(`#error=${error}&state=${STATE}`)).toEqual({ kind: 'error', error, state: STATE });
    }
  });

  it('ignores unknown keys', () => {
    expect(parseCallbackHash(`#code=${CODE}&state=${STATE}&extra=1&foo=bar`)).toEqual({ kind: 'code', code: CODE, state: STATE });
    expect(parseCallbackHash(`#code=${CODE}&state=${STATE}&foo=1&foo=2`)).toEqual({ kind: 'code', code: CODE, state: STATE });
  });

  it.each([
    ['empty', ''],
    ['only #', '#'],
    ['no state', `#code=${CODE}`],
    ['no code or error', `#state=${STATE}`],
    ['both code and error', `#code=${CODE}&error=access_denied&state=${STATE}`],
    ['duplicate code', `#code=${CODE}&code=${CODE}&state=${STATE}`],
    ['duplicate state', `#code=${CODE}&state=${STATE}&state=${STATE}`],
    ['duplicate error', `#error=access_denied&error=server_error&state=${STATE}`],
    ['code too short', `#code=${'a'.repeat(42)}&state=${STATE}`],
    ['code too long', `#code=${'a'.repeat(44)}&state=${STATE}`],
    ['code with a character outside base64url', `#code=${'+'.repeat(43)}&state=${STATE}`],
    ['code with padding', `#code=${'a'.repeat(42)}%3D&state=${STATE}`],
    ['state too short', `#code=${CODE}&state=${'b'.repeat(21)}`],
    ['state too long', `#code=${CODE}&state=${'b'.repeat(23)}`],
    ['state with a space', `#code=${CODE}&state=${'b'.repeat(21)}%20`],
    ['unknown error name', `#error=something_else&state=${STATE}`],
    ['error with a bad state', `#error=access_denied&state=short`],
  ])('treats a %s fragment as malformed', (_name, hash) => {
    expect(parseCallbackHash(hash)).toBeNull();
  });
});

describe('pending sign-in storage', () => {
  const pending = { verifier: VERIFIER, state: STATE };

  it('keeps the verifier and state for the return trip and forgets them when cleared', () => {
    const storage = new MemoryStorage();
    expect(savePending(storage, pending)).toBe(true);
    expect(readPending(storage)).toEqual(pending);
    clearPending(storage);
    expect(readPending(storage)).toBeNull();
  });

  it('reports failure instead of throwing when storage is missing or blocked', () => {
    expect(savePending(null, pending)).toBe(false);
    expect(savePending(throwingStorage(), pending)).toBe(false);
    expect(readPending(null)).toBeNull();
    expect(readPending(throwingStorage())).toBeNull();
    expect(() => clearPending(throwingStorage())).not.toThrow();
  });

  it('treats a stored value that is not a well-formed pair as nothing pending', () => {
    for (const raw of ['not json', '{}', JSON.stringify({ verifier: 'short', state: STATE }), JSON.stringify({ verifier: VERIFIER, state: 3 })]) {
      const storage = new MemoryStorage();
      storage.setItem(PENDING_KEY, raw);
      expect(readPending(storage)).toBeNull();
    }
  });
});

describe('ssoSupported', () => {
  it('is true only for the one origin plotune.net returns to', () => {
    expect(SSO_RETURN_ORIGIN).toBe('https://bridge.plotune.net');
    expect(ssoSupported({ origin: 'https://bridge.plotune.net' })).toBe(true);
    for (const origin of ['http://localhost:4173', 'http://127.0.0.1:4173', 'http://bridge.plotune.net', 'https://bridge.plotune.net.evil.test', 'https://preview.bridge.example.test', 'https://bridge.plotune.net:8443']) {
      expect(ssoSupported({ origin })).toBe(false);
    }
  });
});

describe('sign-in flags', () => {
  it('records and clears the automatic-attempt failure for the tab', () => {
    const storage = new MemoryStorage();
    expect(silentAttemptFailed(storage)).toBe(false);
    expect(markSilentFailed(storage)).toBe(true);
    expect(silentAttemptFailed(storage)).toBe(true);
    expect(storage.data.get(SILENT_FAILED_KEY)).toBe('1');
    clearSilentFailed(storage);
    expect(silentAttemptFailed(storage)).toBe(false);
  });

  it('records a sign-out for the tab, and treats blocked storage as no flag and no write', () => {
    const storage = new MemoryStorage();
    markSignedOutThisTab(storage);
    expect(signedOutThisTab(storage)).toBe(true);
    expect(storage.data.get(SIGNED_OUT_KEY)).toBe('1');
    expect(signedOutThisTab(throwingStorage())).toBe(false);
    expect(silentAttemptFailed(null)).toBe(false);
    expect(markSilentFailed(null)).toBe(false);
    expect(markSilentFailed(throwingStorage())).toBe(false);
    expect(() => clearSilentFailed(throwingStorage())).not.toThrow();
  });

  it('writes the sign-out flag through the storage it is given', () => {
    const spy = vi.fn();
    const storage: SsoStorage = { getItem: () => null, setItem: spy, removeItem: () => undefined };
    markSignedOutThisTab(storage);
    expect(spy).toHaveBeenCalledWith(SIGNED_OUT_KEY, '1');
  });
});
