// Client-side ISO-TP (ISO 15765-2) over Classic CAN, normal addressing: single frames, first/consecutive frames
// and flow control, up to 4095 bytes. It runs in the browser on top of the Bridge's raw frame stream
// (BR-CAN-PRO-002); the device carries only CAN frames. Not claimed: extended/mixed addressing, CAN FD,
// 32-bit lengths, or complete conformance.
import type { CanFrame, TxFrame } from '../protocol/types';
import type { FrameIo } from '../state/store';

export interface IsoTpConfig {
  channel: number;
  txId: number;
  rxId: number;
  extended: boolean;
  /** Byte used to pad every frame to 8 bytes, or null to send the shortest frame. */
  padding: number | null;
  /** Timeout for flow control (N_Bs), consecutive frames (N_Cr) and for waiting on a response, in ms. */
  timeoutMs: number;
  /** Flow control values this side asks the sender for when receiving a multi-frame message. */
  rxBlockSize: number;
  rxStMin: number;
}

export const DEFAULT_ISOTP: Omit<IsoTpConfig, 'channel'> = { txId: 0x700, rxId: 0x708, extended: false, padding: 0x00, timeoutMs: 1000, rxBlockSize: 0, rxStMin: 0 };

export const MAX_ISOTP_PAYLOAD = 4095;
const MAX_WAIT_FRAMES = 10;

export type IsoTpErrorCode = 'timeout' | 'flow-control-timeout' | 'overflow' | 'too-many-waits' | 'sequence' | 'invalid-length' | 'send-failed' | 'closed';

const PLAIN: Record<IsoTpErrorCode, string> = {
  timeout: 'No response arrived in time.',
  'flow-control-timeout': 'The other end did not answer with flow control in time.',
  overflow: 'The other end said it cannot take a message this long.',
  'too-many-waits': 'The other end kept asking to wait.',
  sequence: 'A consecutive frame arrived out of order, so the message was dropped.',
  'invalid-length': 'The message must be between 1 and 4095 bytes.',
  'send-failed': 'The frame could not be sent through the device.',
  closed: 'The ISO-TP link was closed.',
};

export class IsoTpError extends Error {
  readonly code: IsoTpErrorCode;
  constructor(code: IsoTpErrorCode, detail = '') {
    super(detail ? `${PLAIN[code]} (${detail})` : PLAIN[code]);
    this.name = 'IsoTpError';
    this.code = code;
  }
}

interface Reassembly {
  buffer: Uint8Array;
  length: number;
  received: number;
  nextSn: number;
  blockCount: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface FlowControl {
  status: number;
  blockSize: number;
  stMin: number;
}

function stMinToMs(stMin: number): number {
  if (stMin <= 0x7f) return stMin;
  if (stMin >= 0xf1 && stMin <= 0xf9) return 1; // 100-900 microseconds: a browser timer cannot do finer than about a millisecond
  return 127; // reserved values: use the largest legal delay
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class IsoTpLink {
  private unsubscribe: (() => void) | null = null;
  private readonly inbox: Uint8Array[] = [];
  private messageWaiter: { resolve(message: Uint8Array): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  private fcWaiter: { resolve(fc: FlowControl): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  private reassembly: Reassembly | null = null;

  constructor(private readonly io: FrameIo, readonly config: IsoTpConfig) {}

  start(): void {
    if (!this.unsubscribe) this.unsubscribe = this.io.subscribe((frame) => this.onFrame(frame));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const closed = new IsoTpError('closed');
    for (const waiter of [this.messageWaiter, this.fcWaiter]) {
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      waiter.reject(closed);
    }
    this.messageWaiter = this.fcWaiter = null;
    this.abortReassembly();
  }

  /** Discards messages that arrived while nobody was waiting, so a response is never mistaken for an older one. */
  flush(): void {
    this.inbox.length = 0;
  }

  /** Sends one ISO-TP message and waits for one reply message. */
  async transact(payload: Uint8Array, responseTimeoutMs = this.config.timeoutMs): Promise<Uint8Array> {
    this.flush();
    await this.send(payload);
    return this.receive(responseTimeoutMs);
  }

  receive(timeoutMs = this.config.timeoutMs): Promise<Uint8Array> {
    const ready = this.inbox.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.messageWaiter = null;
        reject(new IsoTpError('timeout'));
      }, timeoutMs);
      this.messageWaiter = { resolve, reject, timer };
    });
  }

  async send(payload: Uint8Array): Promise<void> {
    if (payload.length < 1 || payload.length > MAX_ISOTP_PAYLOAD) throw new IsoTpError('invalid-length');
    if (payload.length <= 7) {
      await this.transmit(Uint8Array.of(payload.length, ...payload));
      return;
    }
    const first = Uint8Array.of(0x10 | (payload.length >> 8), payload.length & 0xff, ...payload.subarray(0, 6));
    let fc = this.expectFlowControl(); // listen before sending so a fast reply cannot be missed
    await this.transmit(first);
    let offset = 6;
    let sn = 1;
    let sentInBlock = 0;
    let control = await this.awaitFlowControl(await fc);
    while (offset < payload.length) {
      const chunk = payload.subarray(offset, offset + 7);
      await this.transmit(Uint8Array.of(0x20 | (sn & 0x0f), ...chunk));
      offset += chunk.length;
      sn += 1;
      sentInBlock += 1;
      if (offset >= payload.length) break;
      if (control.blockSize > 0 && sentInBlock >= control.blockSize) {
        fc = this.expectFlowControl();
        control = await this.awaitFlowControl(await fc);
        sentInBlock = 0;
      } else {
        await sleep(stMinToMs(control.stMin));
      }
    }
  }

  // The flow-control promise is created first and awaited later, so it must never reject unhandled in between.
  private expectFlowControl(): Promise<FlowControl> {
    const promise = new Promise<FlowControl>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fcWaiter = null;
        reject(new IsoTpError('flow-control-timeout'));
      }, this.config.timeoutMs);
      this.fcWaiter = { resolve, reject, timer };
    });
    promise.catch(() => undefined); // the caller awaits it later; this keeps an early failure from being reported as unhandled
    return promise;
  }

  private async awaitFlowControl(first: FlowControl): Promise<FlowControl> {
    let fc = first;
    for (let waits = 0; fc.status === 1; waits += 1) {
      if (waits >= MAX_WAIT_FRAMES) throw new IsoTpError('too-many-waits');
      fc = await this.expectFlowControl();
    }
    if (fc.status === 2) throw new IsoTpError('overflow');
    if (fc.status !== 0) throw new IsoTpError('overflow', `unknown flow status ${fc.status}`);
    return fc;
  }

  private frameFor(data: Uint8Array): TxFrame {
    const bytes = this.config.padding === null || data.length >= 8 ? data : Uint8Array.from({ length: 8 }, (_, i) => (i < data.length ? data[i] : this.config.padding!));
    return { channel: this.config.channel, id: this.config.txId, extended: this.config.extended, rtr: false, dlc: bytes.length, data: bytes };
  }

  private async transmit(data: Uint8Array): Promise<void> {
    try {
      await this.io.transmit(this.frameFor(data));
    } catch (error) {
      throw new IsoTpError('send-failed', error instanceof Error ? error.message : String(error));
    }
  }

  private onFrame(frame: CanFrame): void {
    const c = this.config;
    if (frame.direction !== 'rx' || frame.rtr || frame.channel !== c.channel || frame.id !== c.rxId || frame.extended !== c.extended || frame.data.length === 0) return;
    const d = frame.data;
    switch (d[0] >> 4) {
      case 0: {
        const length = d[0] & 0x0f;
        if (length >= 1 && length <= 7 && length <= d.length - 1) this.deliver(d.slice(1, 1 + length));
        break;
      }
      case 1: {
        if (d.length < 8) break;
        const length = ((d[0] & 0x0f) << 8) | d[1];
        if (length < 8) break;
        this.abortReassembly();
        const buffer = new Uint8Array(length);
        buffer.set(d.subarray(2, 8));
        this.reassembly = { buffer, length, received: 6, nextSn: 1, blockCount: 0, timer: null };
        this.armReassemblyTimer();
        void this.sendFlowControl();
        break;
      }
      case 2: {
        const r = this.reassembly;
        if (!r) break;
        if ((d[0] & 0x0f) !== r.nextSn) {
          this.abortReassembly(new IsoTpError('sequence'));
          break;
        }
        const take = Math.min(7, r.length - r.received, d.length - 1);
        r.buffer.set(d.subarray(1, 1 + take), r.received);
        r.received += take;
        r.nextSn = (r.nextSn + 1) & 0x0f;
        r.blockCount += 1;
        if (r.received >= r.length) {
          this.reassembly = null;
          if (r.timer) clearTimeout(r.timer);
          this.deliver(r.buffer);
        } else {
          this.armReassemblyTimer();
          if (c.rxBlockSize > 0 && r.blockCount >= c.rxBlockSize) {
            r.blockCount = 0;
            void this.sendFlowControl();
          }
        }
        break;
      }
      case 3: {
        const waiter = this.fcWaiter;
        if (waiter && d.length >= 3) {
          this.fcWaiter = null;
          clearTimeout(waiter.timer);
          waiter.resolve({ status: d[0] & 0x0f, blockSize: d[1], stMin: d[2] });
        }
        break;
      }
      default:
        break;
    }
  }

  private deliver(message: Uint8Array): void {
    const waiter = this.messageWaiter;
    if (waiter) {
      this.messageWaiter = null;
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      this.inbox.push(message);
    }
  }

  private async sendFlowControl(): Promise<void> {
    try {
      await this.transmit(Uint8Array.of(0x30, this.config.rxBlockSize, this.config.rxStMin));
    } catch (error) {
      this.abortReassembly(error instanceof Error ? error : new IsoTpError('send-failed'));
    }
  }

  private armReassemblyTimer(): void {
    const r = this.reassembly;
    if (!r) return;
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(() => this.abortReassembly(new IsoTpError('timeout', 'consecutive frame')), this.config.timeoutMs);
  }

  private abortReassembly(error?: Error): void {
    const r = this.reassembly;
    if (!r) return;
    if (r.timer) clearTimeout(r.timer);
    this.reassembly = null;
    if (error && this.messageWaiter) {
      const waiter = this.messageWaiter;
      this.messageWaiter = null;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}
