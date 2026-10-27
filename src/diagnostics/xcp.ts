// Client-side XCP on CAN (ASAM XCP, CAN transport), minimal command subset: CONNECT, DISCONNECT, GET_STATUS,
// SET_MTA, SHORT_UPLOAD, UPLOAD, DOWNLOAD. Runs in the browser over the Bridge's raw frames (BR-CAN-PRO-002).
// Not claimed: DAQ, programming, A2L parsing, seed-key unlocking, or complete conformance. It does not map
// addresses to any process memory; it only moves bytes to and from the addresses the user types.
import type { CanFrame, TxFrame } from '../protocol/types';
import type { FrameIo } from '../state/store';

export interface XcpConfig {
  channel: number;
  requestId: number;
  responseId: number;
  extended: boolean;
  timeoutMs: number;
  /** Pad every command to 8 bytes (some ECUs require a fixed DLC). */
  padTo8: boolean;
}

export const DEFAULT_XCP: Omit<XcpConfig, 'channel'> = { requestId: 0x600, responseId: 0x601, extended: false, timeoutMs: 1000, padTo8: false };

export const XCP_ERRORS: Record<number, string> = {
  0x00: 'ERR_CMD_SYNCH',
  0x10: 'ERR_CMD_BUSY',
  0x11: 'ERR_DAQ_ACTIVE',
  0x12: 'ERR_PGM_ACTIVE',
  0x20: 'ERR_CMD_UNKNOWN',
  0x21: 'ERR_CMD_SYNTAX',
  0x22: 'ERR_OUT_OF_RANGE',
  0x23: 'ERR_WRITE_PROTECTED',
  0x24: 'ERR_ACCESS_DENIED',
  0x25: 'ERR_ACCESS_LOCKED',
  0x26: 'ERR_PAGE_NOT_VALID',
  0x27: 'ERR_MODE_NOT_VALID',
  0x28: 'ERR_SEGMENT_NOT_VALID',
  0x29: 'ERR_SEQUENCE',
  0x2a: 'ERR_DAQ_CONFIG',
  0x30: 'ERR_MEMORY_OVERFLOW',
  0x31: 'ERR_GENERIC',
  0x32: 'ERR_VERIFY',
};

const PLAIN_ERRORS: Record<number, string> = {
  0x00: 'The command was not accepted in the current state (for example, not connected yet).',
  0x20: 'The command is not supported.',
  0x21: 'The command was malformed.',
  0x22: 'The address or length is outside what the target allows.',
  0x23: 'That memory is write protected.',
  0x24: 'Access to that memory is denied.',
  0x25: 'Access to that memory is locked.',
};

export class XcpError extends Error {
  readonly code: number | null;
  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = 'XcpError';
    this.code = code;
  }
}

export interface XcpConnection {
  resources: number;
  byteOrder: 'little' | 'big';
  maxCto: number;
  maxDto: number;
  protocolVersion: number;
  transportVersion: number;
}

export interface XcpStatus {
  sessionStatus: number;
  resourceProtection: number;
  sessionConfigId: number;
}

export class XcpClient {
  private connection: XcpConnection | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly io: FrameIo, readonly config: XcpConfig) {}

  get connected(): XcpConnection | null {
    return this.connection;
  }

  /** One command at a time: the protocol has no request ids, so the next reply belongs to the command in flight. */
  private command(bytes: Uint8Array): Promise<Uint8Array> {
    const run = this.queue.then(() => this.exchange(bytes));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private exchange(bytes: Uint8Array): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const c = this.config;
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new XcpError('No answer arrived in time.'))), c.timeoutMs);
      const unsubscribe = this.io.subscribe((frame: CanFrame) => {
        if (frame.direction !== 'rx' || frame.rtr || frame.channel !== c.channel || frame.id !== c.responseId || frame.extended !== c.extended || frame.data.length === 0) return;
        const pid = frame.data[0];
        if (pid === 0xff) finish(() => resolve(frame.data));
        else if (pid === 0xfe) {
          const code = frame.data[1] ?? 0;
          finish(() => reject(new XcpError(`${XCP_ERRORS[code] ?? `error 0x${code.toString(16)}`}: ${PLAIN_ERRORS[code] ?? 'The target reported an error.'}`, code)));
        }
        // 0xFD (event) and 0xFC (service request) packets are not part of this subset; they are ignored.
      });
      const data = c.padTo8 && bytes.length < 8 ? Uint8Array.from({ length: 8 }, (_, i) => bytes[i] ?? 0) : bytes;
      const tx: TxFrame = { channel: c.channel, id: c.requestId, extended: c.extended, rtr: false, dlc: data.length, data };
      this.io.transmit(tx).catch((error: unknown) => finish(() => reject(new XcpError(`The command could not be sent: ${error instanceof Error ? error.message : String(error)}`))));
    });
  }

  private address(value: number): number[] {
    const le = [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
    return this.connection?.byteOrder === 'big' ? le.reverse() : le;
  }

  private requireConnection(): XcpConnection {
    if (!this.connection) throw new XcpError('Connect first.');
    return this.connection;
  }

  async connect(): Promise<XcpConnection> {
    const r = await this.command(Uint8Array.of(0xff, 0x00));
    if (r.length < 8) throw new XcpError('The CONNECT answer was too short.');
    const byteOrder = (r[2] & 1) === 0 ? 'little' : 'big';
    this.connection = {
      resources: r[1],
      byteOrder,
      maxCto: r[3],
      maxDto: byteOrder === 'little' ? r[4] | (r[5] << 8) : (r[4] << 8) | r[5],
      protocolVersion: r[6],
      transportVersion: r[7],
    };
    return this.connection;
  }

  async disconnect(): Promise<void> {
    await this.command(Uint8Array.of(0xfe));
    this.connection = null;
  }

  async getStatus(): Promise<XcpStatus> {
    const r = await this.command(Uint8Array.of(0xfd));
    if (r.length < 6) throw new XcpError('The GET_STATUS answer was too short.');
    return { sessionStatus: r[1], resourceProtection: r[2], sessionConfigId: this.connection?.byteOrder === 'big' ? (r[4] << 8) | r[5] : r[4] | (r[5] << 8) };
  }

  async setMta(address: number): Promise<void> {
    this.requireConnection();
    await this.command(Uint8Array.of(0xf6, 0, 0, 0, ...this.address(address)));
  }

  async shortUpload(address: number, count: number): Promise<Uint8Array> {
    const c = this.requireConnection();
    if (count < 1 || count > c.maxCto - 1) throw new XcpError(`Read between 1 and ${c.maxCto - 1} bytes at a time.`);
    const r = await this.command(Uint8Array.of(0xf4, count, 0, 0, ...this.address(address)));
    return r.slice(1, 1 + count);
  }

  async upload(count: number): Promise<Uint8Array> {
    const c = this.requireConnection();
    if (count < 1 || count > c.maxCto - 1) throw new XcpError(`Read between 1 and ${c.maxCto - 1} bytes at a time.`);
    const r = await this.command(Uint8Array.of(0xf5, count));
    return r.slice(1, 1 + count);
  }

  async download(data: Uint8Array): Promise<void> {
    const c = this.requireConnection();
    if (data.length < 1 || data.length > c.maxCto - 2) throw new XcpError(`Write between 1 and ${c.maxCto - 2} bytes at a time.`);
    await this.command(Uint8Array.of(0xf0, data.length, ...data));
  }

  /** Reads `length` bytes starting at `address`, in the largest pieces the target allows. */
  async readMemory(address: number, length: number): Promise<Uint8Array> {
    const c = this.requireConnection();
    const out = new Uint8Array(length);
    for (let offset = 0; offset < length; ) {
      const count = Math.min(c.maxCto - 1, length - offset);
      out.set(await this.shortUpload(address + offset, count), offset);
      offset += count;
    }
    return out;
  }

  /** Writes `data` starting at `address`: SET_MTA once, then DOWNLOAD pieces, relying on MTA advancing after each. */
  async writeMemory(address: number, data: Uint8Array): Promise<void> {
    const c = this.requireConnection();
    await this.setMta(address);
    for (let offset = 0; offset < data.length; offset += c.maxCto - 2) await this.download(data.subarray(offset, offset + c.maxCto - 2));
  }
}
