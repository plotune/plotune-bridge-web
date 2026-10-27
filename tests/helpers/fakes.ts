import { ContractError } from '../../src/protocol/errors';
import type { WireObject } from '../../src/protocol/wire';
import type { CanFrame, TxFrame } from '../../src/protocol/types';
import type { FrameIo, FrameListener } from '../../src/state/store';
import { TransportOpenError, type CloseInfo, type DeviceTransport, type TransportListener } from '../../src/transport/types';
import type { MockDeviceCore } from './mockDevice';
import type { MockEcu } from './mockEcu';

/** In-memory adapter wired straight to a MockDeviceCore. Messages carry BigInt directly (no JSON), like the real adapter after parsing. */
export class FakeTransport implements DeviceTransport {
  readonly kind = 'fake';
  listener: TransportListener | null = null;
  isOpen = false;
  /** Set to make open() fail the way a browser failure does (always code 1006). */
  failOpen: CloseInfo | null = null;
  autoDeliver = true;
  readonly sent: WireObject[] = [];

  constructor(readonly target: string, readonly device: MockDeviceCore) {}

  setListener(listener: TransportListener): void {
    this.listener = listener;
  }

  async open(): Promise<void> {
    if (this.failOpen) throw new TransportOpenError(this.failOpen);
    this.isOpen = true;
    this.device.attach((m) => queueMicrotask(() => this.isOpen && this.listener?.message(m)));
  }

  send(message: WireObject): void {
    if (!this.isOpen) throw new ContractError('DEVICE_DISCONNECTED', 'closed');
    this.sent.push(message);
    const reply = this.device.handle(message);
    queueMicrotask(() => {
      if (!this.isOpen) return;
      this.listener?.message(reply);
      if (this.autoDeliver) this.device.deliver();
    });
  }

  close(): void {
    if (!this.isOpen) return;
    this.endLink({ phase: 'open', code: 1000, reason: 'client closing', wasClean: true, initiatedBy: 'local' });
  }

  /** The device or network ends the link. */
  dropWith(code: number, reason = ''): void {
    this.endLink({ phase: 'open', code, reason, wasClean: code !== 1006, initiatedBy: 'remote' });
  }

  private endLink(info: CloseInfo): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.device.detach();
    this.listener?.closed(info);
  }
}

/** FrameIo wired to a MockEcu: transmitted frames get answered after `delayMs` each (use fake timers to advance). */
export class EcuLoopback implements FrameIo {
  readonly listeners = new Set<FrameListener>();
  readonly transmitted: TxFrame[] = [];
  private clock = 1000n;

  constructor(readonly ecu: MockEcu, readonly channel = 1, private readonly delayMs = 1) {}

  async transmit(frame: TxFrame): Promise<void> {
    this.transmitted.push(frame);
    this.ecu.receive({ id: frame.id, extended: frame.extended, data: frame.data }).forEach((reply, index) => {
      setTimeout(() => this.emit({ channel: this.channel, id: reply.id, extended: reply.extended, rtr: false, dlc: reply.data.length, data: reply.data, direction: 'rx' }), this.delayMs * (index + 1));
    });
  }

  emit(frame: Omit<CanFrame, 'timestampNs'>): void {
    this.clock += 1000n;
    this.listeners.forEach((l) => l({ ...frame, timestampNs: this.clock }));
  }

  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
