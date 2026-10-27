// The connection layer sits behind this interface. The workspace only ever sees whole contract messages
// (already decoded from JSON, nanosecond fields as BigInt) and link-state changes. A WebRTC data channel or a
// local helper can replace the WebSocket adapter by implementing DeviceTransport; nothing above it changes.
import type { WireObject } from '../protocol/wire';

export interface CloseInfo {
  /** 'connecting': the link never opened. 'open': an established link ended. */
  phase: 'connecting' | 'open';
  /** WebSocket close code where the transport has one (1006 = no close frame was received). */
  code: number | null;
  reason: string;
  wasClean: boolean;
  initiatedBy: 'local' | 'remote';
}

export interface TransportListener {
  message(message: WireObject): void;
  closed(info: CloseInfo): void;
}

export interface DeviceTransport {
  /** Adapter name, shown only in technical details. */
  readonly kind: string;
  readonly target: string;
  /** Resolves once the link is open. Rejects with TransportOpenError. */
  open(): Promise<void>;
  /** Throws ContractError(DEVICE_DISCONNECTED) if the link is not open. */
  send(message: WireObject): void;
  close(): void;
  setListener(listener: TransportListener): void;
}

export type TransportFactory = (target: string) => DeviceTransport;

export class TransportOpenError extends Error {
  readonly info: CloseInfo;
  constructor(info: CloseInfo, message = 'could not open the link') {
    super(message);
    this.name = 'TransportOpenError';
    this.info = info;
  }
}

/** Raised by send() for conditions that are the browser's, not the device's. */
export class TransportError extends Error {
  readonly kind: 'request-too-large' | 'send-buffer-full';
  constructor(kind: TransportError['kind'], message: string) {
    super(message);
    this.name = 'TransportError';
    this.kind = kind;
  }
}
