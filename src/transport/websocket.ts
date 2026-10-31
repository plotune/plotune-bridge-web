// WebSocket adapter: one UTF-8 JSON text frame per contract message (TRANSPORT_ADAPTERS.md), no newline delimiting.
import { ContractError, ProtocolViolation } from '../protocol/errors';
import { MAX_REQUEST_BYTES } from '../protocol/types';
import { encodeWire, parseWire, utf8Length, type WireObject } from '../protocol/wire';
import {
  TransportError,
  TransportOpenError,
  type CloseInfo,
  type ConnectionPath,
  type DeviceTransport,
  type TransportListener,
} from './types';

/** Application close code (3000-4999 is the range a page may use) for "the device sent something invalid". */
export const CLIENT_CLOSE_PROTOCOL = 4000;

export interface WebSocketTransportOptions {
  /** Long on purpose: while the browser shows its local-network permission prompt, the connection just waits. */
  openTimeoutMs?: number;
  /** Inbound messages larger than this (UTF-16 code units) are treated as a protocol violation. */
  maxInboundChars?: number;
  /** Outbound buffer limit; requests are tiny, so a backlog means the link is not draining. */
  maxBufferedBytes?: number;
  webSocketImpl?: typeof WebSocket;
}

export class WebSocketTransport implements DeviceTransport {
  readonly kind = 'websocket';
  readonly target: string;
  private ws: WebSocket | null = null;
  private listener: TransportListener | null = null;
  private localClose = false;
  private opened = false;
  private readonly opts: Required<Omit<WebSocketTransportOptions, 'webSocketImpl'>> & { webSocketImpl?: typeof WebSocket };

  constructor(target: string, options: WebSocketTransportOptions = {}) {
    this.target = target;
    this.opts = { openTimeoutMs: 60_000, maxInboundChars: 1 << 20, maxBufferedBytes: 64 * 1024, ...options };
  }

  setListener(listener: TransportListener): void {
    this.listener = listener;
  }

  open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const Impl = this.opts.webSocketImpl ?? WebSocket;
      let ws: WebSocket;
      try {
        ws = new Impl(this.target);
      } catch (error) {
        // e.g. SecurityError for ws:// from an https page in a browser that forbids it outright
        reject(new TransportOpenError({ phase: 'connecting', code: null, reason: error instanceof Error ? error.name : 'error', wasClean: false, initiatedBy: 'local' }, String(error)));
        return;
      }
      this.ws = ws;
      this.localClose = false;
      this.opened = false;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.localClose = true;
        ws.close();
        reject(new TransportOpenError({ phase: 'connecting', code: null, reason: 'timeout', wasClean: false, initiatedBy: 'local' }, 'timed out waiting for the device'));
      }, this.opts.openTimeoutMs);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.opened = true;
        resolve();
      };
      ws.onmessage = (event: MessageEvent) => this.onMessage(ws, event);
      ws.onclose = (event: CloseEvent) => {
        clearTimeout(timer);
        const info: CloseInfo = {
          phase: this.opened ? 'open' : 'connecting',
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          initiatedBy: this.localClose ? 'local' : 'remote',
        };
        if (this.ws === ws) this.ws = null;
        if (!settled) {
          settled = true;
          reject(new TransportOpenError(info));
        } else if (this.opened) {
          this.listener?.closed(info);
        }
      };
      // onerror carries no detail by design; the close event that follows is the source of truth.
      ws.onerror = () => undefined;
    });
  }

  private onMessage(ws: WebSocket, event: MessageEvent): void {
    if (typeof event.data !== 'string') return this.violation(ws, 'binary frame');
    if (event.data.length > this.opts.maxInboundChars) return this.violation(ws, 'message too large');
    let message: WireObject;
    try {
      message = parseWire(event.data);
    } catch (error) {
      return this.violation(ws, error instanceof ProtocolViolation ? error.message : 'invalid message');
    }
    this.listener?.message(message);
  }

  private violation(ws: WebSocket, reason: string): void {
    this.localClose = true;
    ws.close(CLIENT_CLOSE_PROTOCOL, reason.slice(0, 100));
  }

  send(message: WireObject): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new ContractError('DEVICE_DISCONNECTED', 'the link is not open');
    const text = encodeWire(message);
    if (utf8Length(text) > MAX_REQUEST_BYTES) throw new TransportError('request-too-large', `requests are limited to ${MAX_REQUEST_BYTES} bytes`);
    if (ws.bufferedAmount > this.opts.maxBufferedBytes) throw new TransportError('send-buffer-full', 'the browser has not sent earlier messages yet');
    ws.send(text);
  }

  close(): void {
    const ws = this.ws;
    if (!ws) return;
    this.localClose = true;
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close(1000, 'client closing');
  }

  /** A WebSocket is a direct link to a device on the local network; the browser exposes no path detail. */
  async connectionPath(): Promise<ConnectionPath> {
    return { kind: 'local-network' };
  }
}
