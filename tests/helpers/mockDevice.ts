// A contract-faithful Bridge CAN device (v0.1.0) for tests. It models the documented behavior closely enough that the
// workspace is exercised against realistic messages: unconfigured bit rates, termination off, bounded queues with
// explicit drop reporting, transmit echoes, replace-on-connect (done by whoever hosts it) and 64-bit nanosecond clocks.
import type { WireObject } from '../../src/protocol/wire';
import { MockEcu } from './mockEcu';

export interface MockDeviceOptions {
  deviceId?: string;
  channels?: 1 | 2;
  supportedBitrates?: number[];
  queueCapacity?: number;
  batchSize?: number;
  /** Device monotonic clock in ns. The default sits above 2^60 so every timestamp needs more than 53 bits. */
  clock?: () => bigint;
  wallOffsetNs?: bigint | null;
  ecu?: MockEcu;
  contractVersion?: string;
  /** Override the can_fd field to prove the workspace refuses a device that advertises it. */
  advertiseCanFd?: boolean;
}

interface Ch {
  id: number;
  bitrate: number | null;
  termination: boolean;
  busState: string;
  streaming: boolean;
  queue: WireObject[];
  pendingDropped: number;
  stats: Record<string, number>;
  lastTs: bigint;
}

const BIG = (1n << 60n) + 1n;
export const highClock = (): bigint => BIG + process.hrtime.bigint();

/** JSON text with BigInt written as plain integers, exactly as a device encodes them. */
export function serialize(message: unknown): string {
  return JSON.stringify(message, (_k, v) => (typeof v === 'bigint' ? `~u64~${v}` : v)).replace(/"~u64~(\d+)"/g, '$1');
}

const err = (id: number | null, code: string, message = '', details?: object): WireObject => ({ type: 'response', id, ok: false, error: { code, message, ...(details ? { details } : {}) } });
const ok = (id: number, result: WireObject): WireObject => ({ type: 'response', id, ok: true, result });
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (t: string) => Uint8Array.from(t.match(/../g) ?? [], (h) => parseInt(h, 16));
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export class MockDeviceCore {
  readonly options: Required<Omit<MockDeviceOptions, 'ecu' | 'wallOffsetNs'>> & { ecu: MockEcu | null; wallOffsetNs: bigint | null };
  private sink: ((m: WireObject) => void) | null = null;
  private ready = false;
  private sessions = 0;
  private seq = 0;
  private includeTx = true;
  readonly channels: Ch[];
  /** Every request received, in order, for assertions. */
  readonly requests: WireObject[] = [];

  constructor(options: MockDeviceOptions = {}) {
    this.options = {
      deviceId: 'mock-bridge-can-0001',
      channels: 2,
      supportedBitrates: [125000, 250000, 500000, 1000000],
      queueCapacity: 256,
      batchSize: 64,
      clock: highClock,
      contractVersion: '0.1.0',
      advertiseCanFd: false,
      ecu: null,
      wallOffsetNs: 1_700_000_000_000_000_001n,
      ...options,
    } as MockDeviceCore['options'];
    this.channels = Array.from({ length: this.options.channels }, (_, i) => ({
      id: i + 1,
      bitrate: null,
      termination: false,
      busState: 'error_active',
      streaming: false,
      queue: [],
      pendingDropped: 0,
      lastTs: 0n,
      stats: { rx_received: 0, rx_forwarded: 0, rx_dropped: 0, rx_overflow: 0, tx_sent: 0, tx_failed: 0, tx_echo_dropped: 0, bus_errors: 0 },
    }));
  }

  attach(sink: (m: WireObject) => void): void {
    this.sink = sink;
    this.ready = false;
  }

  detach(): void {
    this.sink = null;
    this.ready = false;
  }

  private ch(value: unknown): Ch | null {
    return isInt(value) ? (this.channels.find((c) => c.id === value) ?? null) : null;
  }

  private status(c: Ch): WireObject {
    return { channel: c.id, name: `CAN${c.id}`, bitrate: c.bitrate, termination: c.termination, bus_state: c.busState, streaming: c.streaming, rx_queue_depth: c.queue.length, rx_queue_capacity: this.options.queueCapacity };
  }

  private select(params: WireObject): Ch[] | WireObject {
    const wanted = params.channels;
    if (wanted === undefined) return this.channels;
    if (!Array.isArray(wanted) || wanted.length === 0) return { bad: 'channels' };
    const list: Ch[] = [];
    for (const w of wanted) {
      const c = this.ch(w);
      if (!c) return { unknown: w };
      list.push(c);
    }
    return list;
  }

  handle(message: WireObject): WireObject {
    this.requests.push(message);
    const id = typeof message.id === 'number' ? message.id : null;
    if (message.type !== 'request' || id === null) return err(id, 'MALFORMED_REQUEST', 'not a request');
    const op = message.op as string;
    const params = (message.params ?? {}) as WireObject;
    if (op !== 'hello' && !this.ready) return err(id, 'NOT_CONNECTED', 'send hello first');
    switch (op) {
      case 'hello': {
        const version = String(params.contract_version ?? '');
        if (version.split('.').slice(0, 2).join('.') !== this.options.contractVersion.split('.').slice(0, 2).join('.')) return err(id, 'UNSUPPORTED_VERSION', 'not supported', { device_contract_version: this.options.contractVersion });
        this.ready = true;
        this.sessions += 1;
        const mono = this.options.clock();
        return ok(id, {
          contract_version: this.options.contractVersion,
          session_id: `${this.options.deviceId}-s${this.sessions}`,
          device_id: this.options.deviceId,
          firmware: 'mock-0.1.0',
          profile: this.options.channels === 2 ? 'prototype2' : 'prototype1',
          can_fd: this.options.advertiseCanFd,
          supported_bitrates: this.options.supportedBitrates,
          rx_queue_capacity: this.options.queueCapacity,
          clock: { monotonic_ns: mono, wall_clock_ns: this.options.wallOffsetNs === null ? null : mono + this.options.wallOffsetNs, wall_clock_synced: this.options.wallOffsetNs !== null },
          channels: this.channels.map((c) => this.status(c)),
        });
      }
      case 'get_channel_status': {
        const s = this.select(params);
        if (!Array.isArray(s)) return err(id, 'UNKNOWN_CHANNEL');
        return ok(id, { channels: s.map((c) => this.status(c)) });
      }
      case 'start_rx': {
        const s = this.select(params);
        if (!Array.isArray(s)) return err(id, 'UNKNOWN_CHANNEL');
        const missing = s.find((c) => c.bitrate === null);
        if (missing) return err(id, 'CHANNEL_NOT_CONFIGURED', `CAN${missing.id} has no bitrate`, { channel: missing.id });
        this.includeTx = params.include_tx !== false;
        s.forEach((c) => (c.streaming = true));
        return ok(id, { channels: s.map((c) => this.status(c)) });
      }
      case 'stop_rx': {
        const s = this.select(params);
        if (!Array.isArray(s)) return err(id, 'UNKNOWN_CHANNEL');
        this.deliver(); // everything captured earlier is delivered before the response
        s.forEach((c) => (c.streaming = false));
        return ok(id, { channels: s.map((c) => this.status(c)) });
      }
      case 'set_bitrate': {
        const c = this.ch(params.channel);
        if (!c) return err(id, 'UNKNOWN_CHANNEL');
        if (!isInt(params.bitrate) || !this.options.supportedBitrates.includes(params.bitrate)) return err(id, 'UNSUPPORTED_BITRATE', '', { supported_bitrates: this.options.supportedBitrates });
        if (c.streaming) return err(id, 'CHANNEL_BUSY');
        c.bitrate = params.bitrate;
        return ok(id, { channel: this.status(c) });
      }
      case 'set_termination': {
        const c = this.ch(params.channel);
        if (!c) return err(id, 'UNKNOWN_CHANNEL');
        if (typeof params.enabled !== 'boolean') return err(id, 'MALFORMED_REQUEST');
        c.termination = params.enabled;
        return ok(id, { channel: this.status(c) });
      }
      case 'get_statistics': {
        const s = this.select(params);
        if (!Array.isArray(s)) return err(id, 'UNKNOWN_CHANNEL');
        const result = ok(id, { timestamp_ns: this.options.clock(), since_ns: 1n, statistics: s.map((c) => ({ channel: c.id, ...c.stats })) });
        if (params.reset === true) s.forEach((c) => Object.keys(c.stats).forEach((k) => (c.stats[k] = 0)));
        return result;
      }
      case 'transmit':
        return this.transmit(id, params);
      default:
        return err(id, 'UNKNOWN_OPERATION', op);
    }
  }

  private transmit(id: number, params: WireObject): WireObject {
    const f = params.frame as WireObject | undefined;
    if (!f || typeof f !== 'object') return err(id, 'MALFORMED_REQUEST');
    const c = this.ch(f.channel);
    if (!c) return err(id, 'UNKNOWN_CHANNEL');
    const ext = f.extended === true;
    if (!isInt(f.id) || f.id < 0 || f.id > (ext ? 0x1fffffff : 0x7ff)) return err(id, 'INVALID_ID');
    if (!isInt(f.dlc) || f.dlc < 0 || f.dlc > 8) return err(id, 'INVALID_DLC');
    if (typeof f.data !== 'string' || !/^([0-9a-f]{2})*$/.test(f.data)) return err(id, 'INVALID_DATA');
    const data = fromHex(f.data);
    if (f.rtr === true ? data.length !== 0 : data.length !== f.dlc) return err(id, f.rtr === true ? 'INVALID_DATA' : 'INVALID_DLC');
    if (c.bitrate === null) return err(id, 'CHANNEL_NOT_CONFIGURED');
    if (c.busState === 'bus_off') return err(id, 'BUS_OFF');
    c.stats.tx_sent += 1;
    const ts = this.stamp(c);
    if (c.streaming && this.includeTx) this.enqueue(c, { channel: c.id, id: f.id, extended: ext, rtr: f.rtr === true, dlc: f.dlc, data: f.data, timestamp_ns: ts, direction: 'tx' }, 'tx');
    if (this.options.ecu && !f.rtr) {
      for (const reply of this.options.ecu.receive({ id: f.id, extended: ext, data })) this.injectRx(c.id, { id: reply.id, extended: reply.extended, data: reply.data });
    }
    return ok(id, { accepted: true });
  }

  private stamp(c: Ch): bigint {
    c.lastTs = this.options.clock() > c.lastTs ? this.options.clock() : c.lastTs + 1n;
    return c.lastTs;
  }

  private enqueue(c: Ch, frame: WireObject, direction: 'rx' | 'tx'): void {
    if (c.queue.length >= this.options.queueCapacity) {
      c.pendingDropped += 1;
      if (direction === 'rx') {
        c.stats.rx_dropped += 1;
        c.stats.rx_overflow += 1;
      } else c.stats.tx_echo_dropped += 1;
      return;
    }
    c.queue.push(frame);
  }

  /** A frame arrives from the bus (only captured while the channel's stream is armed). */
  injectRx(channel: number, f: { id: number; extended?: boolean; rtr?: boolean; data?: Uint8Array; timestampNs?: bigint }): void {
    const c = this.ch(channel);
    if (!c || !c.streaming) return;
    const data = f.data ?? new Uint8Array();
    c.stats.rx_received += 1;
    this.enqueue(c, { channel, id: f.id, extended: f.extended === true, rtr: f.rtr === true, dlc: data.length, data: hex(data), timestamp_ns: f.timestampNs ?? this.stamp(c), direction: 'rx' }, 'rx');
  }

  /** Flushes every channel's queue to the attached client as `frames` batches. */
  deliver(): void {
    if (!this.sink || !this.ready) return;
    for (const c of this.channels) {
      while (c.queue.length || c.pendingDropped) {
        const frames = c.queue.splice(0, this.options.batchSize);
        c.stats.rx_forwarded += frames.filter((f) => f.direction === 'rx').length;
        const dropped = c.pendingDropped;
        c.pendingDropped = 0;
        this.sink({ type: 'event', event: 'frames', data: { seq: this.seq++, channel: c.id, dropped, frames } });
      }
    }
  }

  setBusState(channel: number, busState: string): void {
    const c = this.ch(channel);
    if (!c) return;
    c.busState = busState;
    if (this.sink && this.ready) this.sink({ type: 'event', event: 'channel_status', data: this.status(c) });
  }

  /** Simulates the transport losing a batch: the next real batch carries a gap in `seq`. */
  skipSequence(count = 1): void {
    this.seq += count;
  }
}
