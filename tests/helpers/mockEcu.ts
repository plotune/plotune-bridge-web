// A synthetic ECU for tests: ISO-TP + a small UDS subset + a minimal XCP-on-CAN subset, so the workspace's
// engines are exercised against realistic frame shapes. Test data only: the seed/key pair has no security value.
export interface EcuFrame {
  id: number;
  extended: boolean;
  data: Uint8Array;
}

export interface EcuOptions {
  isoRequestId?: number;
  isoResponseId?: number;
  xcpRequestId?: number;
  xcpResponseId?: number;
  /** Answer service 0x31 with NRC 0x78 first, then a positive answer. */
  pendingService?: number;
  /** Block size / STmin the ECU requests when it receives a multi-frame message. */
  flowBlockSize?: number;
  flowStMin?: number;
  /** Flow status to answer a first frame with: 0 continue, 1 wait, 2 overflow. */
  flowStatus?: number;
  /** When true the ECU never answers a first frame with flow control (for timeout tests). */
  silent?: boolean;
}

const DIDS: Record<number, string> = { 0xf190: 'PLOTUNE-SYNTH-001', 0xf191: 'BENCH', 0xf192: '0.1.0', 0xf193: 'VIRTUAL' };
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

export class MockEcu {
  readonly memory = Uint8Array.from({ length: 256 }, (_, i) => i & 0xff);
  /** Complete UDS requests the ECU assembled, for assertions. */
  readonly received: Uint8Array[] = [];
  private seedIssued = false;
  private xcpConnected = false;
  private mta = 0;
  private rx: { buffer: Uint8Array; length: number; received: number; blockCount: number } | null = null;
  private tx: { payload: Uint8Array; offset: number; sn: number } | null = null;
  private readonly o: Required<Omit<EcuOptions, 'pendingService'>> & { pendingService: number | null };

  constructor(options: EcuOptions = {}) {
    this.o = { isoRequestId: 0x700, isoResponseId: 0x708, xcpRequestId: 0x600, xcpResponseId: 0x601, pendingService: null, flowBlockSize: 0, flowStMin: 0, flowStatus: 0, silent: false, ...options };
  }

  /** Feeds one frame the tester transmitted; returns the frames the ECU transmits in answer, in order. */
  receive(frame: EcuFrame): EcuFrame[] {
    if (frame.id === this.o.xcpRequestId) return [this.out(this.o.xcpResponseId, this.xcp(frame.data))];
    if (frame.id !== this.o.isoRequestId) return [];
    const d = frame.data;
    const pci = d[0] >> 4;
    if (pci === 0) return this.handleMessage(d.slice(1, 1 + (d[0] & 0xf)));
    if (pci === 1) {
      if (this.o.silent) return [];
      const length = ((d[0] & 0xf) << 8) | d[1];
      this.rx = { buffer: new Uint8Array(length), length, received: 6, blockCount: 0 };
      this.rx.buffer.set(d.subarray(2, 8));
      return [this.out(this.o.isoResponseId, Uint8Array.of(0x30 | this.o.flowStatus, this.o.flowBlockSize, this.o.flowStMin))];
    }
    if (pci === 2 && this.rx) {
      const take = Math.min(7, this.rx.length - this.rx.received);
      this.rx.buffer.set(d.subarray(1, 1 + take), this.rx.received);
      this.rx.received += take;
      if (this.rx.received < this.rx.length) {
        this.rx.blockCount += 1;
        if (this.o.flowBlockSize > 0 && this.rx.blockCount % this.o.flowBlockSize === 0) return [this.out(this.o.isoResponseId, Uint8Array.of(0x30, this.o.flowBlockSize, this.o.flowStMin))];
        return [];
      }
      const message = this.rx.buffer;
      this.rx = null;
      return this.handleMessage(message);
    }
    if (pci === 3 && this.tx) return this.continueSending(d[1]);
    return [];
  }

  private handleMessage(request: Uint8Array): EcuFrame[] {
    this.received.push(request);
    const service = request[0];
    const payloads = this.o.pendingService !== null && service === this.o.pendingService
      ? [Uint8Array.of(0x7f, service, 0x78), Uint8Array.of(service + 0x40, 0x01)]
      : [this.uds(request)];
    return payloads.flatMap((payload) => this.startSending(payload));
  }

  private startSending(payload: Uint8Array): EcuFrame[] {
    if (payload.length <= 7) return [this.out(this.o.isoResponseId, Uint8Array.of(payload.length, ...payload))];
    this.tx = { payload, offset: 6, sn: 1 };
    return [this.out(this.o.isoResponseId, Uint8Array.of(0x10 | (payload.length >> 8), payload.length & 0xff, ...payload.subarray(0, 6)))];
  }

  /** Called when the tester's flow control arrives; `blockSize` 0 means "send everything". */
  private continueSending(blockSize: number): EcuFrame[] {
    const t = this.tx!;
    const frames: EcuFrame[] = [];
    while (t.offset < t.payload.length && (blockSize === 0 || frames.length < blockSize)) {
      frames.push(this.out(this.o.isoResponseId, Uint8Array.of(0x20 | (t.sn & 0xf), ...t.payload.subarray(t.offset, t.offset + 7))));
      t.offset += 7;
      t.sn += 1;
    }
    if (t.offset >= t.payload.length) this.tx = null;
    return frames;
  }

  private uds(d: Uint8Array): Uint8Array {
    const s = d[0];
    const nrc = (code: number) => Uint8Array.of(0x7f, s, code);
    if (s === 0x10) {
      if (d.length !== 2) return nrc(0x13);
      if (![1, 2, 3].includes(d[1] & 0x7f)) return nrc(0x12);
      this.seedIssued = false;
      return Uint8Array.of(0x50, d[1] & 0x7f, 0, 0x32, 1, 0xf4);
    }
    if (s === 0x3e) return d.length === 2 && d[1] === 0 ? Uint8Array.of(0x7e, 0) : nrc(d.length !== 2 ? 0x13 : 0x12);
    if (s === 0x22) {
      if (d.length < 3 || d.length % 2 !== 1) return nrc(0x13);
      const out = [0x62];
      for (let i = 1; i < d.length; i += 2) {
        const did = (d[i] << 8) | d[i + 1];
        if (!(did in DIDS)) return nrc(0x31);
        out.push(d[i], d[i + 1], ...ascii(DIDS[did]));
      }
      return Uint8Array.from(out);
    }
    if (s === 0x27) {
      if (d[1] === 1) {
        this.seedIssued = true;
        return Uint8Array.of(0x67, 1, 0x12, 0x34);
      }
      if (d[1] !== 2) return nrc(0x12);
      if (!this.seedIssued) return nrc(0x24);
      this.seedIssued = false;
      return d[2] === 0xb7 && d[3] === 0x91 ? Uint8Array.of(0x67, 2) : nrc(0x35);
    }
    return nrc(0x11);
  }

  private xcp(d: Uint8Array): Uint8Array {
    const err = (code: number) => Uint8Array.of(0xfe, code);
    const cmd = d[0];
    if (cmd === 0xff) {
      this.xcpConnected = true;
      this.mta = 0;
      return Uint8Array.of(0xff, 1, 0, 8, 8, 0, 1, 1);
    }
    if (!this.xcpConnected) return err(0);
    const addr = () => d[4] | (d[5] << 8) | (d[6] << 16) | (d[7] << 24);
    if (cmd === 0xfe) {
      this.xcpConnected = false;
      return Uint8Array.of(0xff);
    }
    if (cmd === 0xfd) return Uint8Array.of(0xff, 0, 0, 0, 0, 0);
    if (cmd === 0xf6) {
      this.mta = addr();
      return Uint8Array.of(0xff);
    }
    if (cmd === 0xf4) {
      const n = d[1];
      if (n < 1 || n > 7 || addr() + n > this.memory.length) return err(0x22);
      this.mta = addr() + n;
      return Uint8Array.of(0xff, ...this.memory.subarray(addr(), addr() + n));
    }
    if (cmd === 0xf5) {
      const n = d[1];
      if (n < 1 || n > 7 || this.mta + n > this.memory.length) return err(0x22);
      const out = Uint8Array.of(0xff, ...this.memory.subarray(this.mta, this.mta + n));
      this.mta += n;
      return out;
    }
    if (cmd === 0xf0) {
      const n = d[1];
      if (n < 1 || n > 6 || this.mta + n > this.memory.length || d.length !== 2 + n) return err(0x22);
      this.memory.set(d.subarray(2, 2 + n), this.mta);
      this.mta += n;
      return Uint8Array.of(0xff);
    }
    return err(0x20);
  }

  private out(id: number, data: Uint8Array): EcuFrame {
    return { id, extended: false, data };
  }
}
