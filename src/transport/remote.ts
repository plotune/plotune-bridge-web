// WebRTC adapter that reaches a device through the cloud signaling relay (services/runtime signaling, protocol 0.1.0-draft).
// The browser is the offerer and opens one reliable, ordered data channel labelled 'contract'. The relay only carries
// signaling. Once the channel opens, the signaling socket is closed (code 1000) to free the relay slot: the link no
// longer needs it, and a later relay bye or restart does not affect the open data channel.
import { ContractError, ProtocolViolation } from '../protocol/errors';
import { MAX_REQUEST_BYTES } from '../protocol/types';
import { encodeWire, parseWire, utf8Length, type WireObject } from '../protocol/wire';
import { TransportError, TransportOpenError, type CloseInfo, type DeviceTransport, type TransportListener } from './types';
import { CLIENT_CLOSE_PROTOCOL } from './websocket';

export const REMOTE_TARGET_PREFIX = 'remote:';
export const DEFAULT_RELAY_URL = 'wss://stream.plotune.net/v1/bridge/signal';

const TARGET_PATTERN = /^remote:([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/;
const PROTOCOL_VERSION = '0.1.0-draft';
const CHANNEL_LABEL = 'contract';
/** The relay refuses signaling messages of 8 KiB or more; an offer that large is treated as a failed open. */
const MAX_SIGNAL_BYTES = 8 * 1024;
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

export interface RemoteTarget {
  projectId: string;
  deviceUuid: string;
}

export interface RemoteCredentials {
  /** Short-lived relay ticket. Sent only in the registration frame; never logged or shown. */
  ticket: string;
  iceServers: RTCIceServer[];
}

export interface RemoteTransportOptions {
  /** Supplied by the caller (the cloud client). The transport never imports cloud code. */
  getCredentials: (projectId: string, deviceUuid: string) => Promise<RemoteCredentials>;
  /** Must be wss:// and carry no query string. */
  relayUrl?: string;
  /** Covers credentials, relay registration, the device joining and the data channel opening. */
  openTimeoutMs?: number;
  /** Spacing between signaling messages. 100 ms keeps the browser at 10 messages per second, half the relay rate. */
  signalIntervalMs?: number;
  /** Inbound messages larger than this (UTF-16 code units) are a protocol violation. */
  maxInboundChars?: number;
  /** Outbound buffer limit on the data channel. */
  maxBufferedBytes?: number;
  webSocketImpl?: typeof WebSocket;
  peerConnectionImpl?: typeof RTCPeerConnection;
}

type Phase = 'idle' | 'connecting' | 'open' | 'closed';
type Signal = Record<string, unknown>;
type EndInfo = Omit<CloseInfo, 'phase'>;

export function isRemoteTarget(target: string): boolean {
  return target.startsWith(REMOTE_TARGET_PREFIX);
}

/** `remote:<projectId>/<deviceUuid>`. Dots and slashes are excluded so the IDs cannot change the request path. */
export function parseRemoteTarget(target: string): RemoteTarget | null {
  const match = TARGET_PATTERN.exec(target);
  return match ? { projectId: match[1], deviceUuid: match[2] } : null;
}

function endInfo(reason: string, initiatedBy: EndInfo['initiatedBy'], code: number | null = null, wasClean = false): EndInfo {
  return { code, reason, wasClean, initiatedBy };
}

function relayCloseReason(code: number): string {
  switch (code) {
    case 4001:
      return 'replaced by another browser session';
    case 4003:
      return 'ticket rejected or expired';
    case 4008:
      return 'relay is busy';
    case 1006:
      return 'could not reach the relay';
    default:
      return 'relay closed the connection';
  }
}

function validRelayAddress(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'wss:' && parsed.search === '' && parsed.hash === '';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Signal {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class RemoteTransport implements DeviceTransport {
  readonly kind = 'webrtc-relay';
  readonly target: string;
  private readonly parsed: RemoteTarget | null;
  private readonly getCredentials: RemoteTransportOptions['getCredentials'];
  private readonly relayUrl: string;
  private readonly openTimeoutMs: number;
  private readonly signalIntervalMs: number;
  private readonly maxInboundChars: number;
  private readonly maxBufferedBytes: number;
  private readonly webSocketImpl: typeof WebSocket | undefined;
  private readonly peerConnectionImpl: typeof RTCPeerConnection | undefined;

  private listener: TransportListener | null = null;
  private phase: Phase = 'idle';
  private resolveOpen: (() => void) | null = null;
  private rejectOpen: ((error: TransportOpenError) => void) | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;

  // Signaling state. The ticket lives only in this field and in the registration frame.
  private ticket = '';
  private iceServers: RTCIceServer[] = [];
  private ws: WebSocket | null = null;
  private signalReady = false;
  private outbox: string[] = [];
  private paceTimer: ReturnType<typeof setTimeout> | null = null;
  private registered = false;
  private devicePresent = false;
  private offering = false;
  private offerSent = false;
  private localCandidates: Signal[] = [];
  private answerSeen = false;
  private remoteReady = false;
  private remoteCandidates: RTCIceCandidateInit[] = [];

  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;

  constructor(target: string, options: RemoteTransportOptions) {
    this.target = target;
    this.parsed = parseRemoteTarget(target);
    this.getCredentials = options.getCredentials;
    this.relayUrl = options.relayUrl ?? DEFAULT_RELAY_URL;
    this.openTimeoutMs = options.openTimeoutMs ?? 30_000;
    this.signalIntervalMs = options.signalIntervalMs ?? 100;
    this.maxInboundChars = options.maxInboundChars ?? 1 << 20;
    this.maxBufferedBytes = options.maxBufferedBytes ?? 64 * 1024;
    this.webSocketImpl = options.webSocketImpl;
    this.peerConnectionImpl = options.peerConnectionImpl;
  }

  setListener(listener: TransportListener): void {
    this.listener = listener;
  }

  open(): Promise<void> {
    if (this.phase !== 'idle') {
      return Promise.reject(new TransportOpenError({ ...endInfo('already used', 'local'), phase: 'connecting' }, 'this link was already opened'));
    }
    return new Promise<void>((resolve, reject) => {
      this.phase = 'connecting';
      this.resolveOpen = resolve;
      this.rejectOpen = reject;
      this.openTimer = setTimeout(() => {
        const offline = this.registered && !this.devicePresent;
        const reason = offline ? 'device is not online' : 'timeout';
        this.terminate(endInfo(reason, 'local'), offline ? 'the device is not online' : 'timed out waiting for the device');
      }, this.openTimeoutMs);
      void this.connect();
    });
  }

  /** Throws ContractError(DEVICE_DISCONNECTED) unless the data channel is open. */
  send(message: WireObject): void {
    const channel = this.channel;
    if (this.phase !== 'open' || !channel || channel.readyState !== 'open') {
      throw new ContractError('DEVICE_DISCONNECTED', 'the link is not open');
    }
    const text = encodeWire(message);
    if (utf8Length(text) > MAX_REQUEST_BYTES) throw new TransportError('request-too-large', `requests are limited to ${MAX_REQUEST_BYTES} bytes`);
    if (channel.bufferedAmount > this.maxBufferedBytes) throw new TransportError('send-buffer-full', 'the browser has not sent earlier messages yet');
    channel.send(text);
  }

  /** Idempotent. An open link reports initiatedBy 'local'; a link still connecting rejects open(). */
  close(): void {
    this.terminate(endInfo('closed by this page', 'local', 1000, true), 'closed before the link opened');
  }

  private async connect(): Promise<void> {
    const target = this.parsed;
    if (!target) {
      this.terminate(endInfo('invalid target', 'local'), 'the remote target is not valid');
      return;
    }
    if (!validRelayAddress(this.relayUrl)) {
      this.terminate(endInfo('invalid relay address', 'local'), 'the relay address must be wss:// without a query string');
      return;
    }
    let credentials: RemoteCredentials;
    try {
      credentials = await this.getCredentials(target.projectId, target.deviceUuid);
    } catch {
      // The caller's error may name the ticket or session; it is deliberately not forwarded.
      this.terminate(endInfo('credentials unavailable', 'local'), 'could not get remote access for this device');
      return;
    }
    if (this.phase !== 'connecting') return;
    if (typeof credentials?.ticket !== 'string' || credentials.ticket === '' || !Array.isArray(credentials.iceServers)) {
      this.terminate(endInfo('invalid credentials', 'local'), 'remote access credentials are not valid');
      return;
    }
    this.ticket = credentials.ticket;
    this.iceServers = credentials.iceServers;
    this.openSignaling(target.deviceUuid);
  }

  private openSignaling(deviceUuid: string): void {
    const Impl = this.webSocketImpl ?? WebSocket;
    let ws: WebSocket;
    try {
      ws = new Impl(this.relayUrl);
    } catch (error) {
      this.terminate(endInfo(error instanceof Error ? error.name : 'error', 'local'), 'could not start the relay connection');
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.signalReady = true;
      // The registration must be the first frame. The ticket is placed here and nowhere else.
      this.sendSignal({ type: 'register', version: PROTOCOL_VERSION, role: 'browser', device_id: deviceUuid, ticket: this.ticket });
    };
    ws.onmessage = (event: MessageEvent) => {
      if (ws === this.ws) this.onRelayMessage(event.data);
    };
    ws.onclose = (event: CloseEvent) => {
      if (ws !== this.ws) return;
      this.ws = null;
      this.signalReady = false;
      this.outbox = [];
      this.clearPace();
      if (this.phase === 'connecting') {
        const reason = relayCloseReason(event.code);
        this.terminate(endInfo(reason, 'remote', event.code, event.wasClean), reason);
      }
    };
    // onerror carries no detail; the close event that follows is the source of truth.
    ws.onerror = () => undefined;
  }

  private onRelayMessage(data: unknown): void {
    if (this.phase !== 'connecting') return;
    let message: unknown;
    if (typeof data === 'string') {
      try {
        message = JSON.parse(data);
      } catch {
        message = undefined;
      }
    }
    if (!isRecord(message) || typeof message.type !== 'string') {
      this.terminate(endInfo('relay sent an invalid message', 'local'), 'the relay sent a message that is not valid');
      return;
    }
    // Unknown fields (the relay's from/to routing fields) are ignored.
    switch (message.type) {
      case 'registered':
        this.registered = true;
        this.maybeOffer();
        return;
      case 'peer':
        if (message.role === 'device' && message.state === 'connected') {
          this.devicePresent = true;
          this.maybeOffer();
        }
        return;
      case 'bye':
        this.terminate(endInfo('device disconnected', 'remote'), 'the device disconnected before the link opened');
        return;
      case 'error':
        if (message.code === 'PEER_NOT_FOUND') {
          this.terminate(endInfo('device is not online', 'remote'), 'the device is not online');
        } else {
          this.terminate(endInfo('relay error', 'remote'), 'the relay reported an error');
        }
        return;
      case 'answer':
        this.onAnswer(message);
        return;
      case 'candidate':
        this.onRemoteCandidate(message);
        return;
      default:
        return;
    }
  }

  private maybeOffer(): void {
    if (this.phase !== 'connecting' || this.offering || !this.registered || !this.devicePresent) return;
    this.offering = true;
    void this.startOffer();
  }

  private async startOffer(): Promise<void> {
    const Impl = this.peerConnectionImpl ?? RTCPeerConnection;
    let pc: RTCPeerConnection;
    try {
      pc = new Impl({ iceServers: this.iceServers });
    } catch {
      this.terminate(endInfo('peer connection unavailable', 'local'), 'this browser could not start a WebRTC connection');
      return;
    }
    this.pc = pc;
    const channel = pc.createDataChannel(CHANNEL_LABEL, { ordered: true });
    this.channel = channel;
    channel.onopen = () => this.onChannelOpen(channel);
    channel.onclose = () => {
      if (channel === this.channel) this.terminate(endInfo('data channel closed', 'remote'), 'the data channel closed before the link opened');
    };
    channel.onmessage = (event: MessageEvent) => this.onChannelMessage(channel, event);
    pc.onconnectionstatechange = () => {
      if (pc === this.pc && pc.connectionState === 'failed') {
        this.terminate(endInfo('peer connection failed', 'remote'), 'the peer connection failed');
      }
    };
    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => this.onLocalCandidate(pc, event.candidate);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (pc !== this.pc) return;
      if (typeof offer.sdp !== 'string' || offer.sdp === '') throw new Error('empty offer');
      this.sendSignal({ type: 'offer', sdp: offer.sdp, sdp_type: 'offer' });
      this.offerSent = true;
      // Candidates gathered before the offer was queued go out behind it, so the device never sees them first.
      for (const candidate of this.localCandidates.splice(0)) this.sendSignal(candidate);
    } catch {
      if (pc === this.pc) this.terminate(endInfo('could not create the offer', 'local'), 'this browser could not create a connection offer');
    }
  }

  private onLocalCandidate(pc: RTCPeerConnection, candidate: RTCIceCandidate | null): void {
    // A null candidate marks end-of-candidates; nothing is sent for it.
    if (pc !== this.pc || candidate === null || candidate.candidate === '') return;
    const message: Signal = {
      type: 'candidate',
      candidate: candidate.candidate,
      sdp_mid: candidate.sdpMid ?? null,
      sdp_m_line_index: candidate.sdpMLineIndex ?? null,
    };
    if (this.offerSent) this.sendSignal(message);
    else this.localCandidates.push(message);
  }

  private onAnswer(message: Signal): void {
    const pc = this.pc;
    if (!pc || !this.offerSent || this.answerSeen) return;
    if (message.sdp_type !== 'answer' || typeof message.sdp !== 'string' || message.sdp === '') {
      this.terminate(endInfo('invalid answer', 'remote'), 'the device sent an invalid answer');
      return;
    }
    this.answerSeen = true;
    pc.setRemoteDescription({ type: 'answer', sdp: message.sdp }).then(
      () => {
        if (pc !== this.pc) return;
        this.remoteReady = true;
        for (const candidate of this.remoteCandidates.splice(0)) this.addRemoteCandidate(pc, candidate);
      },
      () => {
        if (pc === this.pc) this.terminate(endInfo('answer rejected', 'local'), 'this browser could not apply the device answer');
      },
    );
  }

  private onRemoteCandidate(message: Signal): void {
    if (typeof message.candidate !== 'string' || message.candidate === '') return;
    const init: RTCIceCandidateInit = {
      candidate: message.candidate,
      sdpMid: typeof message.sdp_mid === 'string' ? message.sdp_mid : null,
      sdpMLineIndex: typeof message.sdp_m_line_index === 'number' ? message.sdp_m_line_index : null,
    };
    // Candidates can arrive before the answer is applied; they wait here until the remote description is set.
    if (!this.remoteReady || !this.pc) {
      this.remoteCandidates.push(init);
      return;
    }
    this.addRemoteCandidate(this.pc, init);
  }

  private addRemoteCandidate(pc: RTCPeerConnection, init: RTCIceCandidateInit): void {
    try {
      // A candidate the browser refuses (for example a stale one) does not stop the connection.
      void pc.addIceCandidate(init).catch(() => undefined);
    } catch {
      // Same as above: a malformed candidate is ignored.
    }
  }

  private sendSignal(message: Signal): void {
    if (this.phase !== 'connecting' || !this.signalReady) return;
    const text = JSON.stringify(message);
    if (utf8Length(text) >= MAX_SIGNAL_BYTES) {
      this.terminate(endInfo('signaling message too large', 'local'), 'a connection message was too large for the relay');
      return;
    }
    this.outbox.push(text);
    this.pump();
  }

  /** Sends at most one signaling message per interval. */
  private pump(): void {
    const ws = this.ws;
    if (!ws || !this.signalReady || this.paceTimer !== null) return;
    const text = this.outbox.shift();
    if (text === undefined) return;
    ws.send(text);
    this.paceTimer = setTimeout(() => {
      this.paceTimer = null;
      this.pump();
    }, this.signalIntervalMs);
  }

  private clearPace(): void {
    if (this.paceTimer !== null) clearTimeout(this.paceTimer);
    this.paceTimer = null;
  }

  private onChannelOpen(channel: RTCDataChannel): void {
    if (channel !== this.channel || this.phase !== 'connecting') return;
    this.phase = 'open';
    if (this.openTimer !== null) clearTimeout(this.openTimer);
    this.openTimer = null;
    // The link no longer needs the relay. Closing now frees the slot; the device sees a bye, which is harmless here.
    this.closeSignaling('link established');
    const resolve = this.resolveOpen;
    this.resolveOpen = null;
    this.rejectOpen = null;
    resolve?.();
  }

  private onChannelMessage(channel: RTCDataChannel, event: MessageEvent): void {
    if (channel !== this.channel || this.phase !== 'open') return;
    if (typeof event.data !== 'string') return this.violation('binary frame');
    if (event.data.length > this.maxInboundChars) return this.violation('message too large');
    let message: WireObject;
    try {
      message = parseWire(event.data);
    } catch (error) {
      return this.violation(error instanceof ProtocolViolation ? error.message : 'invalid message');
    }
    this.listener?.message(message);
  }

  /** Same close path as WebSocketTransport: the device sent something the contract does not allow. */
  private violation(reason: string): void {
    this.terminate(endInfo(reason.slice(0, 100), 'local', CLIENT_CLOSE_PROTOCOL, true), reason);
  }

  private closeSignaling(reason: string): void {
    const ws = this.ws;
    this.ws = null;
    this.signalReady = false;
    this.outbox = [];
    this.clearPace();
    if (ws && (ws.readyState === SOCKET_CONNECTING || ws.readyState === SOCKET_OPEN)) ws.close(1000, reason);
  }

  private teardown(): void {
    if (this.openTimer !== null) clearTimeout(this.openTimer);
    this.openTimer = null;
    this.closeSignaling('client closing');
    this.localCandidates = [];
    this.remoteCandidates = [];
    const channel = this.channel;
    this.channel = null;
    channel?.close();
    const pc = this.pc;
    this.pc = null;
    pc?.close();
  }

  /**
   * The single exit point. Before open it rejects open(); after open it notifies the listener once.
   * Every handler checks its own object against the current one, so late events from a closed link do nothing.
   */
  private terminate(info: EndInfo, message = info.reason): void {
    const phase = this.phase;
    if (phase !== 'connecting' && phase !== 'open') return;
    const reject = this.rejectOpen;
    this.phase = 'closed';
    this.resolveOpen = null;
    this.rejectOpen = null;
    this.teardown();
    if (phase === 'connecting') {
      reject?.(new TransportOpenError({ ...info, phase: 'connecting' }, message));
    } else {
      this.listener?.closed({ ...info, phase: 'open' });
    }
  }
}
