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

/** The kind of an ICE candidate, as the browser reports it. */
export type CandidateKind = 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown';

/**
 * How the open link actually travels. Only types and protocols are kept: candidate addresses and ports
 * are never part of this value, so it can be shown or logged without exposing the network location.
 */
export type ConnectionPath =
  | { kind: 'local-network' }
  | { kind: 'direct'; local: CandidateKind; remote: CandidateKind; protocol: string | null }
  | { kind: 'relay'; protocol: string | null }
  | { kind: 'unknown' };

/** Bytes moved over the open link, when the adapter can count them. */
export interface LinkTraffic {
  bytesSent: number;
  bytesReceived: number;
}

/** The stage of a remote connection that is running, for the connecting screen. */
export type ConnectStage = 'cloud' | 'device' | 'link';

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
  /** Reports each connection stage as it starts, and null once connecting ends. Optional: only staged adapters report it. */
  onStage?(listener: (stage: ConnectStage | null) => void): void;
  /** The network path of the open link. Optional: adapters that cannot tell report nothing. Must not throw. */
  connectionPath?(): Promise<ConnectionPath>;
  /** Byte counters of the open link, or null when they are not available. Optional. */
  traffic?(): Promise<LinkTraffic | null>;
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
