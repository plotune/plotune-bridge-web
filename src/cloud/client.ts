// Typed client for the Plotune account Worker (api.plotune.net) and the Stream Worker (stream.plotune.net).
// Requests never carry cookies (credentials: 'omit'); the account token is passed in by the caller and only
// ever sent as a bearer header. Thrown errors carry fixed, safe messages: no token, code, verifier or response body
// is ever placed in an error. Sign-in happens on plotune.net; this client only exchanges the one-time code.

export const DEFAULT_API_BASE = 'https://api.plotune.net';
export const DEFAULT_STREAM_BASE = 'https://stream.plotune.net';
export const REQUEST_TIMEOUT_MS = 15_000;

export type CloudErrorCode =
  | 'invalid-request'
  | 'sign-in-expired'
  | 'service-unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'network'
  | 'bad-response';

const SAFE_MESSAGES: Record<CloudErrorCode, string> = {
  'invalid-request': 'The cloud rejected the request.',
  'sign-in-expired': 'Sign-in expired. Try again.',
  'service-unavailable': 'The cloud service is temporarily unavailable. Try again later.',
  unauthorized: 'Your cloud session is no longer valid. Sign in again.',
  forbidden: 'Your cloud account does not have permission for this action.',
  'not-found': 'The requested cloud resource was not found.',
  'rate-limited': 'Too many requests. Wait a while and try again.',
  network: 'Could not reach the cloud. Check the connection and try again.',
  'bad-response': 'The cloud returned an unexpected response.',
};

export class CloudError extends Error {
  readonly code: CloudErrorCode;

  constructor(code: CloudErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'CloudError';
    this.code = code;
  }
}

export interface CloudProject {
  id: string;
  name: string;
  role: string;
}

export interface CloudDevice {
  deviceUuid: string;
  deviceId: string;
  deviceType: string;
  pairedAt: string;
}

export interface PairingToken {
  pairingToken: string;
  /** Unix time in seconds, as sent by the Worker. */
  expiresAt: number;
  expiresIn: number;
}

export interface BrowserTicket {
  ticket: string;
  /** Unix time in seconds, as sent by the Worker. */
  expiresAt: number;
}

export interface IceServersResult {
  iceServers: RTCIceServer[];
  /** Unix time in seconds, as sent by the Worker. */
  expiresAt: number;
}

export interface BridgeToken {
  accessToken: string;
  /** Lifetime in seconds, counted from the moment the exchange succeeded. */
  expiresIn: number;
  username: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CloudClientOptions {
  fetchImpl?: FetchLike;
  apiBase?: string;
  streamBase?: string;
}

export interface CloudClient {
  /** Exchanges the one-time code from the plotune.net redirect, with its PKCE verifier, for an account token. */
  exchangeBridgeCode(code: string, verifier: string): Promise<BridgeToken>;
  listProjects(token: string): Promise<CloudProject[]>;
  listDevices(token: string, projectId: string): Promise<CloudDevice[]>;
  createPairingToken(token: string, projectId: string): Promise<PairingToken>;
  createBrowserTicket(token: string, projectId: string, deviceUuid: string): Promise<BrowserTicket>;
  /** Pass the remote ticket here, not the account token. */
  fetchIceServers(ticket: string, projectId: string, deviceUuid: string): Promise<IceServersResult>;
}

interface RequestSpec {
  method: 'GET' | 'POST';
  url: string;
  /** Sent as Authorization: Bearer. */
  bearer?: string;
  json?: Record<string, unknown>;
  /** The bridge exchange maps 400 (code invalid, expired or already used) to sign-in-expired. */
  badRequestCode?: CloudErrorCode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function codeForStatus(status: number, badRequestCode: CloudErrorCode | undefined): CloudErrorCode {
  if (status === 400 && badRequestCode !== undefined) return badRequestCode;
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'service-unavailable';
  if (status >= 400) return 'invalid-request';
  return 'bad-response';
}

async function send(fetchImpl: FetchLike, spec: RequestSpec): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (spec.bearer !== undefined) headers.Authorization = `Bearer ${spec.bearer}`;
  const init: RequestInit = {
    method: spec.method,
    headers,
    credentials: 'omit',
    redirect: 'error',
    signal: controller.signal,
  };
  if (spec.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(spec.json);
  }
  try {
    let response: Response;
    try {
      response = await fetchImpl(spec.url, init);
    } catch {
      throw new CloudError('network');
    }
    if (!response.ok) throw new CloudError(codeForStatus(response.status, spec.badRequestCode));
    try {
      return await response.json();
    } catch {
      throw new CloudError(controller.signal.aborted ? 'network' : 'bad-response');
    }
  } finally {
    clearTimeout(timer);
  }
}

function unexpected(): CloudError {
  return new CloudError('bad-response');
}

function parseBridgeToken(body: unknown): BridgeToken {
  if (!isRecord(body) || !nonEmptyString(body.access_token) || !finiteNumber(body.expires_in) || body.expires_in <= 0) throw unexpected();
  if (typeof body.username !== 'string') throw unexpected();
  return { accessToken: body.access_token, expiresIn: body.expires_in, username: body.username };
}

function parseProject(value: unknown): CloudProject {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name)) throw unexpected();
  // The Worker's project list carries no role; a missing role means a plain member.
  const role = nonEmptyString(value.role) ? value.role : 'Member';
  return { id: value.id, name: value.name, role };
}

function parseProjects(body: unknown): CloudProject[] {
  // The Worker answers { items, plan }. A bare array or { projects } is accepted as well.
  let list: unknown;
  if (Array.isArray(body)) list = body;
  else if (isRecord(body) && Array.isArray(body.items)) list = body.items;
  else if (isRecord(body) && Array.isArray(body.projects)) list = body.projects;
  else throw unexpected();
  return (list as unknown[]).map(parseProject);
}

function parseDevice(value: unknown): CloudDevice {
  if (!isRecord(value)) throw unexpected();
  const { device_uuid, device_id, device_type, paired_at } = value;
  if (!nonEmptyString(device_uuid) || typeof device_id !== 'string' || typeof device_type !== 'string' || typeof paired_at !== 'string') {
    throw unexpected();
  }
  return { deviceUuid: device_uuid, deviceId: device_id, deviceType: device_type, pairedAt: paired_at };
}

function parseDevices(body: unknown): CloudDevice[] {
  if (!isRecord(body) || !Array.isArray(body.devices)) throw unexpected();
  return body.devices.map(parseDevice);
}

function parsePairingToken(body: unknown): PairingToken {
  if (!isRecord(body) || !nonEmptyString(body.token) || !finiteNumber(body.expires_at) || !finiteNumber(body.expires_in)) {
    throw unexpected();
  }
  return { pairingToken: body.token, expiresAt: body.expires_at, expiresIn: body.expires_in };
}

function parseBrowserTicket(body: unknown): BrowserTicket {
  if (!isRecord(body) || !nonEmptyString(body.ticket) || !finiteNumber(body.expires_at)) throw unexpected();
  return { ticket: body.ticket, expiresAt: body.expires_at };
}

function parseIceServer(value: unknown): RTCIceServer {
  if (!isRecord(value)) throw unexpected();
  const { urls, username, credential } = value;
  let server: RTCIceServer;
  if (nonEmptyString(urls)) {
    server = { urls };
  } else if (Array.isArray(urls) && urls.length > 0 && urls.every(nonEmptyString)) {
    server = { urls: [...urls] };
  } else {
    throw unexpected();
  }
  if (username !== undefined) {
    if (typeof username !== 'string') throw unexpected();
    server.username = username;
  }
  if (credential !== undefined) {
    if (typeof credential !== 'string') throw unexpected();
    server.credential = credential;
  }
  return server;
}

function parseIceServers(body: unknown): IceServersResult {
  if (!isRecord(body) || !Array.isArray(body.iceServers) || !finiteNumber(body.expires_at)) throw unexpected();
  return { iceServers: body.iceServers.map(parseIceServer), expiresAt: body.expires_at };
}

function requireText(value: string): string {
  if (!nonEmptyString(value)) throw new CloudError('invalid-request');
  return value;
}

export function createCloudClient(options: CloudClientOptions = {}): CloudClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const apiBase = options.apiBase ?? DEFAULT_API_BASE;
  const streamBase = options.streamBase ?? DEFAULT_STREAM_BASE;
  const projectPath = (projectId: string) => `${streamBase}/v1/projects/${encodeURIComponent(requireText(projectId))}`;
  const devicePath = (projectId: string, deviceUuid: string) =>
    `${projectPath(projectId)}/devices/${encodeURIComponent(requireText(deviceUuid))}`;

  return {
    async exchangeBridgeCode(code, verifier) {
      // No Authorization header: the one-time code and its verifier are the whole credential here.
      const body = await send(fetchImpl, {
        method: 'POST',
        url: `${apiBase}/auth/bridge-token`,
        json: { code: requireText(code), code_verifier: requireText(verifier) },
        badRequestCode: 'sign-in-expired',
      });
      return parseBridgeToken(body);
    },

    async listProjects(token) {
      const body = await send(fetchImpl, { method: 'GET', url: `${streamBase}/v1/projects`, bearer: requireText(token) });
      return parseProjects(body);
    },

    async listDevices(token, projectId) {
      const body = await send(fetchImpl, {
        method: 'GET',
        url: `${projectPath(projectId)}/devices`,
        bearer: requireText(token),
      });
      return parseDevices(body);
    },

    async createPairingToken(token, projectId) {
      const body = await send(fetchImpl, {
        method: 'POST',
        url: `${projectPath(projectId)}/devices/pairing-token`,
        bearer: requireText(token),
      });
      return parsePairingToken(body);
    },

    async createBrowserTicket(token, projectId, deviceUuid) {
      const body = await send(fetchImpl, {
        method: 'POST',
        url: `${devicePath(projectId, deviceUuid)}/remote-ticket`,
        bearer: requireText(token),
        json: { role: 'browser' },
      });
      return parseBrowserTicket(body);
    },

    async fetchIceServers(ticket, projectId, deviceUuid) {
      const body = await send(fetchImpl, {
        method: 'GET',
        url: `${devicePath(projectId, deviceUuid)}/ice-servers`,
        bearer: requireText(ticket),
      });
      return parseIceServers(body);
    },
  };
}
