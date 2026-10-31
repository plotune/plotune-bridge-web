import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudError, REQUEST_TIMEOUT_MS, createCloudClient, type CloudClient, type FetchLike } from '../src/cloud/client';

interface Recorded {
  url: string;
  init: RequestInit;
}

const API = 'https://api.plotune.net';
const STREAM = 'https://stream.plotune.net';
const ACCOUNT_TOKEN = 'acct.token-value_123';
const TICKET = 'ticket.value-456';
const PROJECT = 'proj_1';
const DEVICE = '11111111-2222-3333-4444-555555555555';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A fake fetch that records every call and answers with the next queued response. */
function fakeFetch(...answers: Array<Response | (() => Promise<Response>)>) {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init: init ?? {} });
    const next = answers.shift();
    if (next === undefined) throw new Error('no answer queued');
    return typeof next === 'function' ? next() : next;
  };
  return { fetchImpl, calls };
}

function clientWith(fetchImpl: FetchLike): CloudClient {
  return createCloudClient({ fetchImpl });
}

async function failure(promise: Promise<unknown>): Promise<CloudError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CloudError) return error;
    throw error;
  }
  throw new Error('expected the call to reject');
}

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

const CODE = 'one-time-code-value';
const VERIFIER = 'pkce-verifier-value';
const BRIDGE_TOKEN_BODY = { access_token: ACCOUNT_TOKEN, token_type: 'bearer', expires_in: 28800, username: 'kantr' };

describe('exchangeBridgeCode', () => {
  it('posts the code and verifier as JSON, with no cookies and no Authorization header, and returns the token', async () => {
    const { fetchImpl, calls } = fakeFetch(json(200, BRIDGE_TOKEN_BODY));
    const result = await clientWith(fetchImpl).exchangeBridgeCode(CODE, VERIFIER);
    expect(result).toEqual({ accessToken: ACCOUNT_TOKEN, expiresIn: 28800, username: 'kantr' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${API}/auth/bridge-token`);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('omit');
    expect(calls[0].init.redirect).toBe('error');
    expect(header(calls[0].init, 'Content-Type')).toBe('application/json');
    expect(header(calls[0].init, 'Authorization')).toBeNull();
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ code: CODE, code_verifier: VERIFIER });
  });

  it('maps 400 (code invalid, expired or already used) to sign-in-expired with the fixed message', async () => {
    const { fetchImpl } = fakeFetch(json(400, { error: 'invalid_grant' }));
    const error = await failure(clientWith(fetchImpl).exchangeBridgeCode(CODE, VERIFIER));
    expect(error).toMatchObject({ code: 'sign-in-expired' });
    expect(error.message).toBe('Sign-in expired. Try again.');
  });

  it('maps 401 to unauthorized and 503 to service-unavailable', async () => {
    const { fetchImpl } = fakeFetch(json(401, {}), json(503, { error: { code: 'service_unavailable' } }));
    expect(await failure(clientWith(fetchImpl).exchangeBridgeCode(CODE, VERIFIER))).toMatchObject({ code: 'unauthorized' });
    expect(await failure(clientWith(fetchImpl).exchangeBridgeCode(CODE, VERIFIER))).toMatchObject({ code: 'service-unavailable' });
  });

  it('maps a network failure to network', async () => {
    const { fetchImpl } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await failure(clientWith(fetchImpl).exchangeBridgeCode(CODE, VERIFIER))).toMatchObject({ code: 'network' });
  });

  it('rejects a success body without a usable token, lifetime or username', async () => {
    const bodies = [
      {},
      { access_token: '', expires_in: 60, username: 'kantr' },
      { access_token: 42, expires_in: 60, username: 'kantr' },
      { access_token: ACCOUNT_TOKEN, expires_in: 0, username: 'kantr' },
      { access_token: ACCOUNT_TOKEN, expires_in: '60', username: 'kantr' },
      { access_token: ACCOUNT_TOKEN, expires_in: 60 },
      { access_token: ACCOUNT_TOKEN, expires_in: 60, username: 7 },
      ['x'],
      null,
      'token',
    ];
    for (const body of bodies) {
      const { fetchImpl } = fakeFetch(json(200, body));
      expect(await failure(clientWith(fetchImpl).exchangeBridgeCode(CODE, VERIFIER))).toMatchObject({ code: 'bad-response' });
    }
  });

  it('refuses an empty code or verifier without touching the network', async () => {
    const { fetchImpl, calls } = fakeFetch();
    expect(await failure(clientWith(fetchImpl).exchangeBridgeCode('', VERIFIER))).toMatchObject({ code: 'invalid-request' });
    expect(await failure(clientWith(fetchImpl).exchangeBridgeCode(CODE, ''))).toMatchObject({ code: 'invalid-request' });
    expect(calls).toHaveLength(0);
  });
});

describe('listProjects', () => {
  it('reads the Worker shape { items, plan } and sends the account token as bearer', async () => {
    const { fetchImpl, calls } = fakeFetch(json(200, {
      items: [{ id: 'p1', name: 'Line A', ownerId: 'o', revision: 1, createdAt: 'x', updatedAt: 'y', keyPrefix: 'k' }],
      plan: { plan: 'free', projectLimit: 20, ownedProjects: 1 },
    }));
    const projects = await clientWith(fetchImpl).listProjects(ACCOUNT_TOKEN);
    expect(projects).toEqual([{ id: 'p1', name: 'Line A', role: 'Member' }]);
    expect(calls[0].url).toBe(`${STREAM}/v1/projects`);
    expect(calls[0].init.credentials).toBe('omit');
    expect(header(calls[0].init, 'Authorization')).toBe(`Bearer ${ACCOUNT_TOKEN}`);
  });

  it('also accepts a bare array and a { projects } object, and keeps a provided role', async () => {
    const bare = fakeFetch(json(200, [{ id: 'a', name: 'A', role: 'Owner' }]));
    expect(await clientWith(bare.fetchImpl).listProjects(ACCOUNT_TOKEN)).toEqual([{ id: 'a', name: 'A', role: 'Owner' }]);
    const wrapped = fakeFetch(json(200, { projects: [{ id: 'b', name: 'B' }] }));
    expect(await clientWith(wrapped.fetchImpl).listProjects(ACCOUNT_TOKEN)).toEqual([{ id: 'b', name: 'B', role: 'Member' }]);
  });

  it('rejects malformed project entries and unexpected shapes', async () => {
    const shapes = [
      { items: [{ id: 'p1' }] },
      { items: [{ name: 'no id' }] },
      { items: 'nope' },
      { plan: {} },
      null,
    ];
    for (const body of shapes) {
      const { fetchImpl } = fakeFetch(json(200, body));
      expect(await failure(clientWith(fetchImpl).listProjects(ACCOUNT_TOKEN))).toMatchObject({ code: 'bad-response' });
    }
  });

  it('maps 401 to unauthorized and 403 to forbidden', async () => {
    const { fetchImpl } = fakeFetch(json(401, {}), json(403, {}));
    expect(await failure(clientWith(fetchImpl).listProjects(ACCOUNT_TOKEN))).toMatchObject({ code: 'unauthorized' });
    expect(await failure(clientWith(fetchImpl).listProjects(ACCOUNT_TOKEN))).toMatchObject({ code: 'forbidden' });
  });
});

describe('listDevices', () => {
  it('maps the snake_case wire shape to camelCase', async () => {
    const { fetchImpl, calls } = fakeFetch(json(200, {
      devices: [{ device_uuid: DEVICE, device_id: 'bridge-7', device_type: 'bridge', paired_at: '2026-10-30T10:00:00.000Z' }],
    }));
    const devices = await clientWith(fetchImpl).listDevices(ACCOUNT_TOKEN, PROJECT);
    expect(devices).toEqual([{ deviceUuid: DEVICE, deviceId: 'bridge-7', deviceType: 'bridge', pairedAt: '2026-10-30T10:00:00.000Z' }]);
    expect(calls[0].url).toBe(`${STREAM}/v1/projects/proj_1/devices`);
    expect(calls[0].init.method).toBe('GET');
    expect(header(calls[0].init, 'Authorization')).toBe(`Bearer ${ACCOUNT_TOKEN}`);
  });

  it('encodes the project id in the path', async () => {
    const { fetchImpl, calls } = fakeFetch(json(200, { devices: [] }));
    expect(await clientWith(fetchImpl).listDevices(ACCOUNT_TOKEN, 'a/b c')).toEqual([]);
    expect(calls[0].url).toBe(`${STREAM}/v1/projects/a%2Fb%20c/devices`);
  });

  it('rejects a device entry with missing or wrongly typed fields', async () => {
    const { fetchImpl } = fakeFetch(json(200, { devices: [{ device_uuid: DEVICE, device_id: 'x', device_type: 'bridge' }] }));
    expect(await failure(clientWith(fetchImpl).listDevices(ACCOUNT_TOKEN, PROJECT))).toMatchObject({ code: 'bad-response' });
    const numbers = fakeFetch(json(200, { devices: [{ device_uuid: DEVICE, device_id: 1, device_type: 'bridge', paired_at: 'x' }] }));
    expect(await failure(clientWith(numbers.fetchImpl).listDevices(ACCOUNT_TOKEN, PROJECT))).toMatchObject({ code: 'bad-response' });
    const notObject = fakeFetch(json(200, { devices: ['device'] }));
    expect(await failure(clientWith(notObject.fetchImpl).listDevices(ACCOUNT_TOKEN, PROJECT))).toMatchObject({ code: 'bad-response' });
  });

  it('maps 404 to not-found', async () => {
    const { fetchImpl } = fakeFetch(json(404, { error: { code: 'not_found', message: 'Route not found' } }));
    expect(await failure(clientWith(fetchImpl).listDevices(ACCOUNT_TOKEN, PROJECT))).toMatchObject({ code: 'not-found' });
  });
});

describe('createPairingToken', () => {
  it('posts with the bearer token and maps the response', async () => {
    const { fetchImpl, calls } = fakeFetch(json(200, { token: 'pair-raw', project_id: PROJECT, expires_at: 1_800_000_000, expires_in: 600 }));
    const result = await clientWith(fetchImpl).createPairingToken(ACCOUNT_TOKEN, PROJECT);
    expect(result).toEqual({ pairingToken: 'pair-raw', expiresAt: 1_800_000_000, expiresIn: 600 });
    expect(calls[0].url).toBe(`${STREAM}/v1/projects/proj_1/devices/pairing-token`);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('omit');
    expect(header(calls[0].init, 'Authorization')).toBe(`Bearer ${ACCOUNT_TOKEN}`);
  });

  it('maps 403 to forbidden and rejects a missing token', async () => {
    const forbidden = fakeFetch(json(403, {}));
    expect(await failure(clientWith(forbidden.fetchImpl).createPairingToken(ACCOUNT_TOKEN, PROJECT))).toMatchObject({ code: 'forbidden' });
    const missing = fakeFetch(json(200, { project_id: PROJECT, expires_at: 1, expires_in: 600 }));
    expect(await failure(clientWith(missing.fetchImpl).createPairingToken(ACCOUNT_TOKEN, PROJECT))).toMatchObject({ code: 'bad-response' });
  });
});

describe('createBrowserTicket', () => {
  it('posts the browser role with the account token and maps the response', async () => {
    const { fetchImpl, calls } = fakeFetch(json(200, {
      ticket: TICKET, expires_at: 1_800_000_060, expires_in: 60, role: 'browser', device_uuid: DEVICE, project_id: PROJECT,
    }));
    const result = await clientWith(fetchImpl).createBrowserTicket(ACCOUNT_TOKEN, PROJECT, DEVICE);
    expect(result).toEqual({ ticket: TICKET, expiresAt: 1_800_000_060 });
    expect(calls[0].url).toBe(`${STREAM}/v1/projects/proj_1/devices/${DEVICE}/remote-ticket`);
    expect(calls[0].init.method).toBe('POST');
    expect(header(calls[0].init, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ role: 'browser' });
    expect(header(calls[0].init, 'Authorization')).toBe(`Bearer ${ACCOUNT_TOKEN}`);
  });

  it('maps 429 to rate-limited and 404 to not-found', async () => {
    const limited = fakeFetch(json(429, {}), json(404, {}));
    expect(await failure(clientWith(limited.fetchImpl).createBrowserTicket(ACCOUNT_TOKEN, PROJECT, DEVICE))).toMatchObject({ code: 'rate-limited' });
    expect(await failure(clientWith(limited.fetchImpl).createBrowserTicket(ACCOUNT_TOKEN, PROJECT, DEVICE))).toMatchObject({ code: 'not-found' });
  });

  it('refuses a device id that could change the path', async () => {
    const { fetchImpl, calls } = fakeFetch();
    expect(await failure(clientWith(fetchImpl).createBrowserTicket(ACCOUNT_TOKEN, PROJECT, ''))).toMatchObject({ code: 'invalid-request' });
    expect(calls).toHaveLength(0);
  });
});

describe('fetchIceServers', () => {
  it('sends the remote ticket, never the account token, as the bearer', async () => {
    const { fetchImpl, calls } = fakeFetch(json(200, {
      iceServers: [
        { urls: ['stun:stun.example.net:3478'] },
        { urls: ['turn:turn.example.net:3478?transport=udp', 'turns:turn.example.net:5349'], username: 'u1', credential: 'c1' },
      ],
      expires_at: 1_800_000_600,
    }));
    const result = await clientWith(fetchImpl).fetchIceServers(TICKET, PROJECT, DEVICE);
    expect(result.expiresAt).toBe(1_800_000_600);
    expect(result.iceServers).toEqual([
      { urls: ['stun:stun.example.net:3478'] },
      { urls: ['turn:turn.example.net:3478?transport=udp', 'turns:turn.example.net:5349'], username: 'u1', credential: 'c1' },
    ]);
    expect(calls[0].url).toBe(`${STREAM}/v1/projects/proj_1/devices/${DEVICE}/ice-servers`);
    expect(calls[0].init.method).toBe('GET');
    expect(header(calls[0].init, 'Authorization')).toBe(`Bearer ${TICKET}`);
    expect(header(calls[0].init, 'Authorization')).not.toContain(ACCOUNT_TOKEN);
    expect(calls[0].init.credentials).toBe('omit');
  });

  it('accepts a single url string', async () => {
    const { fetchImpl } = fakeFetch(json(200, { iceServers: [{ urls: 'stun:one.example.net:3478' }], expires_at: 5 }));
    expect((await clientWith(fetchImpl).fetchIceServers(TICKET, PROJECT, DEVICE)).iceServers).toEqual([{ urls: 'stun:one.example.net:3478' }]);
  });

  it('rejects malformed ICE entries', async () => {
    const bodies = [
      { iceServers: [{ urls: [] }], expires_at: 5 },
      { iceServers: [{ urls: [1] }], expires_at: 5 },
      { iceServers: [{ urls: 'stun:x', credential: 7 }], expires_at: 5 },
      { iceServers: [{ urls: 'stun:x' }] },
      { iceServers: 'nope', expires_at: 5 },
    ];
    for (const body of bodies) {
      const { fetchImpl } = fakeFetch(json(200, body));
      expect(await failure(clientWith(fetchImpl).fetchIceServers(TICKET, PROJECT, DEVICE))).toMatchObject({ code: 'bad-response' });
    }
  });

  it('maps 401 (expired ticket) to unauthorized and 503 to service-unavailable', async () => {
    const { fetchImpl } = fakeFetch(json(401, {}), json(503, {}));
    expect(await failure(clientWith(fetchImpl).fetchIceServers(TICKET, PROJECT, DEVICE))).toMatchObject({ code: 'unauthorized' });
    expect(await failure(clientWith(fetchImpl).fetchIceServers(TICKET, PROJECT, DEVICE))).toMatchObject({ code: 'service-unavailable' });
  });
});

describe('errors and safety', () => {
  it('never puts tokens, codes, verifiers or response bodies into messages', async () => {
    const leaky = JSON.stringify({ error: { code: 'invalid_grant', message: `bad code ${CODE} verifier ${VERIFIER} token ${ACCOUNT_TOKEN}` }, detail: ACCOUNT_TOKEN });
    const { fetchImpl } = fakeFetch(new Response(leaky, { status: 400 }), new Response(leaky, { status: 500 }));
    const client = clientWith(fetchImpl);
    const first = await failure(client.exchangeBridgeCode(CODE, VERIFIER));
    const second = await failure(client.listProjects(ACCOUNT_TOKEN));
    for (const error of [first, second]) {
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('CloudError');
      for (const secret of [CODE, VERIFIER, ACCOUNT_TOKEN, 'invalid_grant']) {
        expect(error.message).not.toContain(secret);
        expect(String(error)).not.toContain(secret);
      }
    }
    expect(first.code).toBe('sign-in-expired');
    expect(second.code).toBe('service-unavailable');
  });

  it('a non-JSON success body is bad-response', async () => {
    const { fetchImpl } = fakeFetch(new Response('<html>oops</html>', { status: 200 }));
    expect(await failure(clientWith(fetchImpl).listProjects(ACCOUNT_TOKEN))).toMatchObject({ code: 'bad-response' });
  });

  it('a blank bearer token is refused before any request', async () => {
    const { fetchImpl, calls } = fakeFetch();
    expect(await failure(clientWith(fetchImpl).listProjects(''))).toMatchObject({ code: 'invalid-request' });
    expect(calls).toHaveLength(0);
  });

  it('other 4xx statuses are invalid-request', async () => {
    const { fetchImpl } = fakeFetch(new Response('', { status: 413 }));
    expect(await failure(clientWith(fetchImpl).listProjects(ACCOUNT_TOKEN))).toMatchObject({ code: 'invalid-request' });
  });
});

describe('timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a request that gets no answer within 15 seconds', async () => {
    let signal: AbortSignal | null | undefined;
    const fetchImpl: FetchLike = (_url, init) => {
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    };
    expect(REQUEST_TIMEOUT_MS).toBe(15_000);
    const pending = failure(clientWith(fetchImpl).listProjects(ACCOUNT_TOKEN));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(await pending).toMatchObject({ code: 'network' });
  });

  it('a body that stalls past the timeout is network, not bad-response', async () => {
    // Headers arrive, the body never does; like a real fetch, the abort signal errors the body stream.
    const fetchImpl: FetchLike = async (_url, init) => {
      const stalled = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(stalled, { status: 200 });
    };
    const pending = failure(clientWith(fetchImpl).listProjects(ACCOUNT_TOKEN));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await pending).toMatchObject({ code: 'network' });
  });
});

describe('defaults', () => {
  it('uses the production hosts when none are given', async () => {
    const seen: string[] = [];
    const client = createCloudClient({
      fetchImpl: async (url) => {
        seen.push(url);
        return json(200, BRIDGE_TOKEN_BODY);
      },
    });
    await client.exchangeBridgeCode(CODE, VERIFIER);
    expect(seen).toEqual([`${API}/auth/bridge-token`]);
  });

  it('honours custom bases', async () => {
    const seen: string[] = [];
    const client = createCloudClient({
      apiBase: 'https://api.test.invalid',
      streamBase: 'https://stream.test.invalid',
      fetchImpl: async (url) => {
        seen.push(url);
        return json(200, { items: [] });
      },
    });
    await client.exchangeBridgeCode(CODE, VERIFIER).catch(() => undefined);
    await client.listProjects(ACCOUNT_TOKEN);
    expect(seen).toEqual(['https://api.test.invalid/auth/bridge-token', 'https://stream.test.invalid/v1/projects']);
  });
});
