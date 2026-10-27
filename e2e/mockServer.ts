// A WebSocket host for MockDeviceCore: one UTF-8 JSON text frame per message, replace-on-connect (close 4001),
// an Origin allow-list, binary frames refused (1003), and controls for tests (drop the link with a chosen close code).
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { MockDeviceCore, serialize, type MockDeviceOptions } from '../tests/helpers/mockDevice';

const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export interface MockServerOptions extends MockDeviceOptions {
  port?: number;
  /** Extra origins allowed besides localhost ones. Requests without an Origin header are always allowed. */
  origins?: string[];
  tickMs?: number;
  /** Serve wss:// with this certificate (tests pass a throwaway self-signed one). */
  tls?: { cert: string; key: string };
}

export class MockDeviceServer {
  readonly core: MockDeviceCore;
  private readonly wss: WebSocketServer;
  private readonly https: HttpsServer | null;
  private readonly scheme: 'ws' | 'wss';
  private current: WebSocket | null = null;
  private readonly timer: NodeJS.Timeout;
  private generators: NodeJS.Timeout[] = [];
  readonly origins: string[];
  /** Every Origin header seen on a handshake, accepted or not. */
  readonly seenOrigins: (string | undefined)[] = [];
  connections = 0;

  constructor(options: MockServerOptions = {}) {
    const { port = 0, origins = [], tickMs = 10, tls, ...device } = options;
    this.origins = origins;
    this.core = new MockDeviceCore(device);
    this.scheme = tls ? 'wss' : 'ws';
    this.https = tls ? createHttpsServer(tls) : null;
    this.wss = new WebSocketServer({
      ...(this.https ? { server: this.https } : { host: '127.0.0.1', port }),
      maxPayload: 64 * 1024,
      verifyClient: ({ origin }, done) => {
        this.seenOrigins.push(origin);
        done(origin === undefined || LOCALHOST.test(origin) || this.origins.includes(origin), 403, 'Origin not allowed');
      },
    });
    this.https?.listen(port, '127.0.0.1');
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.timer = setInterval(() => this.core.deliver(), tickMs);
  }

  private get address(): AddressInfo | string | null {
    return this.https ? this.https.address() : this.wss.address();
  }

  get url(): string {
    return `${this.scheme}://127.0.0.1:${(this.address as AddressInfo).port}`;
  }

  async ready(): Promise<this> {
    if (!this.address) await new Promise<void>((resolve) => (this.https ?? this.wss).once('listening', resolve));
    return this;
  }

  private onConnection(ws: WebSocket): void {
    this.connections += 1;
    const previous = this.current;
    this.current = ws;
    this.core.attach((m) => ws.readyState === ws.OPEN && ws.send(serialize(m)));
    previous?.close(4001, 'replaced by a new connection');
    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(1003, 'binary frames are not part of the contract');
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return ws.send(JSON.stringify({ type: 'response', id: null, ok: false, error: { code: 'MALFORMED_REQUEST', message: 'invalid JSON' } }));
      }
      ws.send(serialize(this.core.handle(message as never)));
    });
    ws.on('close', () => {
      if (this.current === ws) {
        this.current = null;
        this.core.detach();
      }
    });
  }

  get connected(): boolean {
    return this.current !== null;
  }

  /** Ends the current link the way a device or network would. */
  drop(code: number, reason = ''): void {
    if (code === 1006) this.current?.terminate();
    else this.current?.close(code, reason);
  }

  /** Emits frames at a steady rate on a channel until stopped. */
  generate(channel: number, hz: number, id = 0x100): void {
    let n = 0;
    this.generators.push(setInterval(() => this.core.injectRx(channel, { id, data: Uint8Array.of(n++ & 0xff, 0xaa) }), 1000 / hz));
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    this.generators.forEach(clearInterval);
    this.wss.clients.forEach((c) => c.terminate());
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    if (this.https) await new Promise<void>((resolve) => this.https!.close(() => resolve()));
  }
}
