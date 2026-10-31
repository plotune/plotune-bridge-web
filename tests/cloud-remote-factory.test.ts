// The cloud side of a remote connection: credential steps, the reasons they report, and what they keep or forget.
// No network: the cloud client is a fake and the relay WebSocket is a stand-in that never opens.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudError, type CloudClient } from '../src/cloud/client';
import { createCloudSession } from '../src/cloud/session';
import { cloudRemoteFactory } from '../src/createStore';
import { TransportOpenError } from '../src/transport/types';

const ACCOUNT_TOKEN = 'account-token-value';
const TICKET = 'ticket-value';
const ICE = [{ urls: 'turn:turn.example.test:3478', username: 'u', credential: 'c' }];

function fakeClient(overrides: Partial<CloudClient> = {}): CloudClient {
  return {
    exchangeBridgeCode: vi.fn(async () => ({ accessToken: ACCOUNT_TOKEN, expiresIn: 28800, username: 'kantr' })),
    listProjects: vi.fn(async () => []),
    listDevices: vi.fn(async () => []),
    createPairingToken: vi.fn(async () => ({ pairingToken: 'plt_pair_x', expiresAt: 0, expiresIn: 120 })),
    createBrowserTicket: vi.fn(async () => ({ ticket: TICKET, expiresAt: 0 })),
    fetchIceServers: vi.fn(async () => ({ iceServers: ICE, expiresAt: 0 })),
    ...overrides,
  };
}

function signedInSession() {
  const session = createCloudSession();
  session.setToken(ACCOUNT_TOKEN);
  return session;
}

afterEach(() => vi.unstubAllGlobals());

describe('cloud remote transport: failures before the relay', () => {
  it('reports not-signed-in without calling the cloud when there is no session', async () => {
    const client = fakeClient();
    const transport = cloudRemoteFactory({ client, session: createCloudSession() })('proj_1', 'dev-1');
    const failure = await transport.open().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TransportOpenError);
    expect((failure as TransportOpenError).info.reason).toBe('not-signed-in');
    expect(client.createBrowserTicket).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', 'no-access'],
    ['not-found', 'not-found'],
    ['service-unavailable', 'cloud-unavailable'],
    ['network', 'cloud-unavailable'],
  ] as const)('maps a %s answer to the ticket request to %s and keeps the session', async (code, reason) => {
    const session = signedInSession();
    const client = fakeClient({ createBrowserTicket: vi.fn(async () => { throw new CloudError(code); }) });
    const failure = await cloudRemoteFactory({ client, session })('proj_1', 'dev-1').open().catch((error: unknown) => error);
    expect((failure as TransportOpenError).info.reason).toBe(reason);
    expect(session.getToken()).toBe(ACCOUNT_TOKEN);
  });

  it('forgets the account token when the server rejects it on the ticket request', async () => {
    const session = signedInSession();
    const client = fakeClient({ createBrowserTicket: vi.fn(async () => { throw new CloudError('unauthorized'); }) });
    const failure = await cloudRemoteFactory({ client, session })('proj_1', 'dev-1').open().catch((error: unknown) => error);
    expect((failure as TransportOpenError).info.reason).toBe('not-signed-in');
    expect(session.getToken()).toBeNull();
  });

  it('keeps the session when the relay ICE request is rejected, because only the ticket was refused', async () => {
    const session = signedInSession();
    const client = fakeClient({ fetchIceServers: vi.fn(async () => { throw new CloudError('unauthorized'); }) });
    const failure = await cloudRemoteFactory({ client, session })('proj_1', 'dev-1').open().catch((error: unknown) => error);
    expect((failure as TransportOpenError).info.reason).toBe('cloud-unavailable');
    expect(session.getToken()).toBe(ACCOUNT_TOKEN);
  });

  it('never puts the account token or the ticket into the reported failure', async () => {
    const session = signedInSession();
    const client = fakeClient({ createBrowserTicket: vi.fn(async () => { throw new CloudError('forbidden'); }) });
    const failure = (await cloudRemoteFactory({ client, session })('proj_1', 'dev-1').open().catch((error: unknown) => error)) as TransportOpenError;
    const text = JSON.stringify({ message: failure.message, info: failure.info });
    expect(text).not.toContain(ACCOUNT_TOKEN);
    expect(text).not.toContain(TICKET);
  });
});

describe('cloud remote transport: credentials and relay', () => {
  it('asks for a browser ticket with the account token, then the ICE servers with the ticket, and opens the relay', async () => {
    const sockets: string[] = [];
    class NeverOpens {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: ((event: { code: number; wasClean: boolean }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly url: string) {
        sockets.push(url);
      }
      send(): void {
        throw new Error('not expected before open');
      }
      close(): void {
        this.readyState = 3;
      }
    }
    vi.stubGlobal('WebSocket', NeverOpens);
    const session = signedInSession();
    const client = fakeClient();
    const transport = cloudRemoteFactory({ client, session })('proj_1', 'dev-1');
    expect(transport.target).toBe('remote:proj_1/dev-1');
    const opening = transport.open();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(client.createBrowserTicket).toHaveBeenCalledWith(ACCOUNT_TOKEN, 'proj_1', 'dev-1');
    expect(client.fetchIceServers).toHaveBeenCalledWith(TICKET, 'proj_1', 'dev-1');
    expect(sockets).toEqual(['wss://stream.plotune.net/v1/bridge/signal']);
    transport.close();
    await expect(opening).rejects.toBeInstanceOf(TransportOpenError);
  });
});
