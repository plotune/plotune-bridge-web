// One protocol session over a DeviceTransport: hello, request/response with timeouts, and events.
// A reconnect is a new DeviceSession (SPEC section 7: a new connection is a new session; nothing is replayed).
import { decodeBatch, decodeChannel, decodeChannels, decodeChannelStatus, decodeDescriptor, decodeStatisticsResult } from '../protocol/decode';
import { ContractError, ProtocolViolation } from '../protocol/errors';
import {
  CONTRACT_VERSION,
  DEVICE_ERROR_CODES,
  isCompatibleVersion,
  type ChannelStatus,
  type DeviceDescriptor,
  type DeviceErrorCode,
  type FrameBatch,
  type StatisticsResult,
  type TxFrame,
} from '../protocol/types';
import type { WireObject } from '../protocol/wire';
import { bytesToHex } from '../lib/bytes';
import { TransportError, type CloseInfo, type DeviceTransport } from '../transport/types';

export interface SessionEvents {
  frames?(batch: FrameBatch): void;
  /** Batches the transport lost (a gap in `seq` within this session). */
  batchesLost?(count: number): void;
  channelStatus?(status: ChannelStatus): void;
  closed?(info: CloseInfo): void;
}

export interface SessionOptions {
  requestTimeoutMs?: number;
  helloTimeoutMs?: number;
}

interface Pending {
  resolve(result: WireObject): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class DeviceSession {
  descriptor: DeviceDescriptor | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private lastSeq: number | null = null;
  private violation: string | null = null;
  private closedNotified = false;
  private readonly opts: Required<SessionOptions>;

  constructor(
    private readonly transport: DeviceTransport,
    private readonly events: SessionEvents = {},
    options: SessionOptions = {},
  ) {
    this.opts = { requestTimeoutMs: 3000, helloTimeoutMs: 5000, ...options };
    transport.setListener({ message: (m) => this.onMessage(m), closed: (info) => this.onClosed(info) });
  }

  /** Opens the link and says hello. Rejects with TransportOpenError if the link cannot be opened. */
  async connect(): Promise<DeviceDescriptor> {
    await this.transport.open();
    try {
      const result = await this.request('hello', { contract_version: CONTRACT_VERSION, client: 'plotune-bridge-web' }, this.opts.helloTimeoutMs);
      const descriptor = decodeDescriptor(result);
      if (!isCompatibleVersion(descriptor.contractVersion)) {
        throw new ContractError('UNSUPPORTED_VERSION', `device speaks ${descriptor.contractVersion}, this page speaks ${CONTRACT_VERSION}`, { deviceContractVersion: descriptor.contractVersion });
      }
      this.descriptor = descriptor;
      return descriptor;
    } catch (error) {
      if (error instanceof ProtocolViolation) {
        this.violation = error.message;
        this.transport.close();
        throw new ContractError('INTERNAL_ERROR', `the device answered hello with something invalid: ${error.message}`);
      }
      this.transport.close();
      throw error;
    }
  }

  close(): void {
    this.transport.close();
  }

  // -- operations -----------------------------------------------------------

  async channelStatus(channels?: number[]): Promise<ChannelStatus[]> {
    return decodeChannels(await this.request('get_channel_status', channels ? { channels } : {}));
  }

  async startRx(channels?: number[], includeTx = true): Promise<ChannelStatus[]> {
    return decodeChannels(await this.request('start_rx', { ...(channels ? { channels } : {}), include_tx: includeTx }));
  }

  async stopRx(channels?: number[]): Promise<ChannelStatus[]> {
    return decodeChannels(await this.request('stop_rx', channels ? { channels } : {}));
  }

  async setBitrate(channel: number, bitrate: number): Promise<ChannelStatus> {
    return decodeChannel(await this.request('set_bitrate', { channel, bitrate }));
  }

  async setTermination(channel: number, enabled: boolean): Promise<ChannelStatus> {
    return decodeChannel(await this.request('set_termination', { channel, enabled }));
  }

  async transmit(frame: TxFrame): Promise<void> {
    await this.request('transmit', {
      frame: { channel: frame.channel, id: frame.id, extended: frame.extended, rtr: frame.rtr, dlc: frame.dlc, data: bytesToHex(frame.data) },
    });
  }

  async statistics(channels?: number[], reset = false): Promise<StatisticsResult> {
    return decodeStatisticsResult(await this.request('get_statistics', { ...(channels ? { channels } : {}), reset }));
  }

  // -- plumbing --------------------------------------------------------------

  private request(op: string, params: WireObject, timeoutMs = this.opts.requestTimeoutMs): Promise<WireObject> {
    return new Promise<WireObject>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ContractError('TIMEOUT', `no answer to ${op} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.transport.send({ type: 'request', id, op, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        if (error instanceof TransportError) {
          reject(new ContractError(error.kind === 'request-too-large' ? 'MALFORMED_REQUEST' : 'TX_QUEUE_FULL', error.message));
        } else {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
  }

  private onMessage(message: WireObject): void {
    try {
      if (message.type === 'response') this.onResponse(message);
      else if (message.type === 'event') this.onEvent(message);
      else throw new ProtocolViolation('message has an unknown type');
    } catch (error) {
      if (error instanceof ProtocolViolation) {
        this.violation = error.message;
        this.transport.close(); // closing is the only safe response to a contract violation
      } else {
        throw error;
      }
    }
  }

  private onResponse(message: WireObject): void {
    const id = message.id;
    if (typeof id !== 'number') return; // an unparseable-request answer carries id null; nothing is waiting on it
    const pending = this.pending.get(id);
    if (!pending) return; // late answer after a timeout
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (message.ok === true) {
      if (typeof message.result !== 'object' || message.result === null) throw new ProtocolViolation('ok response without a result');
      pending.resolve(message.result as WireObject);
    } else {
      const error = (message.error ?? {}) as WireObject;
      const code = DEVICE_ERROR_CODES.includes(error.code as DeviceErrorCode) ? (error.code as DeviceErrorCode) : 'INTERNAL_ERROR';
      pending.reject(new ContractError(code, typeof error.message === 'string' ? error.message : '', (error.details as Record<string, unknown>) ?? {}));
    }
  }

  private onEvent(message: WireObject): void {
    if (message.event === 'frames') {
      const batch = decodeBatch(message.data);
      if (this.lastSeq !== null && batch.seq !== this.lastSeq + 1) this.events.batchesLost?.(Math.max(0, batch.seq - this.lastSeq - 1));
      this.lastSeq = batch.seq;
      this.events.frames?.(batch);
    } else if (message.event === 'channel_status') {
      this.events.channelStatus?.(decodeChannelStatus(message.data));
    }
    // other event names are ignored so a newer minor version does not break an older page
  }

  private onClosed(info: CloseInfo): void {
    if (this.closedNotified) return;
    this.closedNotified = true;
    const finalInfo = this.violation ? { ...info, code: 4000, reason: this.violation } : info;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new ContractError('DEVICE_DISCONNECTED', 'the link ended', { close: finalInfo }));
      this.pending.delete(id);
    }
    this.events.closed?.(finalInfo);
  }
}
