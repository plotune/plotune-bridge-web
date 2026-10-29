// Workspace state: connection lifecycle, device and channel status, capture, trace, drops, transmit log.
// Framework-agnostic so it can be tested without React. Every callback from a session carries the
// generation it belongs to; anything from an older connection (a replaced or abandoned session) is ignored.
import { bytesToHex } from '../lib/bytes';
import { connectPolicy, type BrowserInfo } from '../lib/browser';
import { parseTarget } from '../lib/target';
import { ContractError, describeErrorCode } from '../protocol/errors';
import type { CanFrame, ChannelStatistics, ChannelStatus, DeviceDescriptor, FrameBatch, TxFrame } from '../protocol/types';
import { DeviceSession } from '../device/session';
import { explainClose, explainOpenFailure, type Notice, type PermissionState } from '../transport/notices';
import { TransportOpenError, type CloseInfo, type TransportFactory } from '../transport/types';
import { TraceBuffer } from './trace';

export type Phase = 'idle' | 'connecting' | 'connected' | 'closed';

export interface TxLogEntry {
  id: number;
  frame: TxFrame;
  ok: boolean;
  message: string;
}

export interface WorkspaceState {
  phase: Phase;
  target: string;
  notice: Notice | null;
  /** True once a connection attempt has taken a while: the browser may be waiting for the user's permission answer. */
  slowConnect: boolean;
  permission: PermissionState;
  descriptor: DeviceDescriptor | null;
  channels: ChannelStatus[];
  statistics: ChannelStatistics[];
  capturing: boolean;
  captureChannels: number[];
  busy: boolean;
  sessionNumber: number;
  /** Batches the transport lost, summed over this page's sessions. */
  lostBatches: number;
  /** Frames the device reported as dropped through the stream, by channel, summed over this page's sessions. */
  droppedReported: Record<number, number>;
  actionError: string | null;
  txLog: TxLogEntry[];
  traceVersion: number;
}

export interface WorkspaceEnv {
  transportFactory: TransportFactory;
  browser: BrowserInfo;
  pageIsSecure: boolean;
  pageOrigin: string;
  queryPermission(loopback: boolean): Promise<PermissionState>;
  /** Coalesces notifications to one per frame of the display. */
  schedule(fn: () => void): void;
  statsIntervalMs: number;
  slowConnectMs: number;
}

export type FrameListener = (frame: CanFrame) => void;

export interface FrameIo {
  transmit(frame: TxFrame): Promise<void>;
  subscribe(listener: FrameListener): () => void;
}

export function defaultEnv(overrides: Partial<WorkspaceEnv> & Pick<WorkspaceEnv, 'transportFactory' | 'browser' | 'queryPermission'>): WorkspaceEnv {
  return {
    pageIsSecure: typeof location !== 'undefined' && location.protocol === 'https:',
    pageOrigin: typeof location !== 'undefined' ? location.origin : '',
    schedule: (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => fn()) : setTimeout(fn, 16)),
    statsIntervalMs: 1000,
    slowConnectMs: 1500,
    ...overrides,
  };
}

const INITIAL: WorkspaceState = {
  phase: 'idle',
  target: '',
  notice: null,
  slowConnect: false,
  permission: 'unknown',
  descriptor: null,
  channels: [],
  statistics: [],
  capturing: false,
  captureChannels: [],
  busy: false,
  sessionNumber: 0,
  lostBatches: 0,
  droppedReported: {},
  actionError: null,
  txLog: [],
  traceVersion: 0,
};

export class WorkspaceStore {
  readonly trace = new TraceBuffer();
  private state: WorkspaceState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly frameListeners = new Set<FrameListener>();
  private session: DeviceSession | null = null;
  private generation = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyQueued = false;
  private txCounter = 0;
  private knownDeviceId: string | null = null;

  constructor(private readonly env: WorkspaceEnv) {}

  // -- subscription -----------------------------------------------------------

  getState = (): WorkspaceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<WorkspaceState>): void {
    this.state = { ...this.state, ...patch };
    this.queueNotify();
  }

  private queueNotify(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    this.env.schedule(() => {
      this.notifyQueued = false;
      this.listeners.forEach((l) => l());
    });
  }

  /** Frames seen on the stream, in arrival order, including this device's own transmissions (direction tx). */
  diagnosticsIo(channelOf?: () => number): FrameIo {
    return {
      transmit: (frame) => this.requireSession().transmit({ ...frame, channel: channelOf ? channelOf() : frame.channel }),
      subscribe: (listener) => {
        this.frameListeners.add(listener);
        return () => this.frameListeners.delete(listener);
      },
    };
  }

  // -- connection ---------------------------------------------------------------

  async connect(input: string): Promise<void> {
    const target = parseTarget(input);
    const policy = connectPolicy(this.env.browser, target, this.env.pageIsSecure);
    if (!policy.allowed) {
      this.set({
        phase: 'closed',
        notice: {
          kind: 'blocked-by-browser',
          severity: 'error',
          title: 'This address cannot be opened from this browser',
          summary: policy.reason ?? 'The address is not valid.',
          steps: [],
          technical: `browser: ${this.env.browser.name} (${this.env.browser.family}) · page secure: ${this.env.pageIsSecure}`,
        },
      });
      return;
    }

    const generation = this.beginGeneration();
    this.set({ phase: 'connecting', target: target.url, notice: null, slowConnect: false, actionError: null, descriptor: null, channels: [], statistics: [], capturing: false });
    this.slowTimer = setTimeout(() => {
      if (generation === this.generation && this.state.phase === 'connecting') this.set({ slowConnect: true });
    }, this.env.slowConnectMs);

    const transport = this.env.transportFactory(target.url);
    const session = new DeviceSession(transport, {
      frames: (batch) => generation === this.generation && this.onBatch(batch),
      batchesLost: (count) => generation === this.generation && this.onBatchesLost(count),
      channelStatus: (status) => generation === this.generation && this.onChannelStatus(status),
      closed: (info) => generation === this.generation && this.onClosed(info),
    });
    this.session = session;

    try {
      const descriptor = await session.connect();
      if (generation !== this.generation) return;
      this.clearSlowTimer();
      const permission = await this.env.queryPermission(target.loopback);
      if (generation !== this.generation) return;
      // A different device starts a clean trace: frames and counters of two devices must never be read as one.
      const differentDevice = this.knownDeviceId !== null && this.knownDeviceId !== descriptor.deviceId;
      if (differentDevice) this.trace.clear();
      const reconnect = this.state.sessionNumber > 0 && !differentDevice;
      this.knownDeviceId = descriptor.deviceId;
      this.trace.push({
        kind: 'session',
        text: reconnect
          ? `Reconnected (new session ${descriptor.sessionId}). Frames the device captured while disconnected follow, with their original timestamps.`
          : differentDevice
            ? `Connected to ${descriptor.deviceId}, a different device. The earlier trace was cleared.`
            : `Connected to ${descriptor.deviceId}.`,
      });
      this.set({
        phase: 'connected',
        descriptor,
        channels: descriptor.channels,
        capturing: descriptor.channels.some((c) => c.streaming),
        captureChannels: descriptor.channels.map((c) => c.channel),
        sessionNumber: this.state.sessionNumber + 1,
        ...(differentDevice ? { lostBatches: 0, droppedReported: {}, txLog: [] } : {}),
        permission,
        traceVersion: this.trace.version,
      });
      this.startPolling();
    } catch (error) {
      if (generation !== this.generation) return;
      this.clearSlowTimer();
      const permission = await this.env.queryPermission(target.loopback);
      if (generation !== this.generation) return;
      if (error instanceof TransportOpenError) {
        this.set({ phase: 'closed', permission, notice: explainOpenFailure(error.info, { pageOrigin: this.env.pageOrigin, targetUrl: target.url, permission }) });
      } else if (error instanceof ContractError && error.code === 'DEVICE_DISCONNECTED') {
        const info = (error.details.close as CloseInfo | undefined) ?? { phase: 'open', code: null, reason: '', wasClean: false, initiatedBy: 'remote' };
        this.set({ phase: 'closed', permission, notice: explainClose(info) });
      } else {
        const code = error instanceof ContractError ? error.code : 'INTERNAL_ERROR';
        this.set({
          phase: 'closed',
          permission,
          notice: {
            kind: 'protocol',
            severity: 'error',
            title: 'Connected, but the device did not complete the handshake',
            summary: code === 'TIMEOUT' ? 'The device accepted the connection but did not answer in time.' : describeErrorCode(code),
            steps: ['Check the device software version, then try again.'],
            technical: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  disconnect(): void {
    const session = this.session;
    this.beginGeneration();
    session?.close();
    this.session = null;
    this.set({ phase: 'closed', capturing: false, notice: { kind: 'ended', severity: 'info', title: 'Disconnected', summary: 'You disconnected from the device.', steps: [], technical: '' } });
  }

  /** Back to address entry without touching the device. */
  reset(): void {
    this.set({ phase: 'idle', notice: null, actionError: null });
  }

  private beginGeneration(): number {
    this.generation += 1;
    this.stopPolling();
    this.clearSlowTimer();
    const previous = this.session;
    this.session = null;
    previous?.close();
    return this.generation;
  }

  private onClosed(info: CloseInfo): void {
    this.stopPolling();
    this.session = null;
    this.set({ phase: 'closed', capturing: false, notice: explainClose(info) });
  }

  // -- stream -------------------------------------------------------------------

  private onBatch(batch: FrameBatch): void {
    if (batch.dropped > 0) {
      this.trace.push({ kind: 'drop', channel: batch.channel, count: batch.dropped });
      this.set({ droppedReported: { ...this.state.droppedReported, [batch.channel]: (this.state.droppedReported[batch.channel] ?? 0) + batch.dropped } });
    }
    for (const frame of batch.frames) {
      this.trace.push({ kind: 'frame', frame });
      this.frameListeners.forEach((l) => l(frame));
    }
    this.set({ traceVersion: this.trace.version });
  }

  private onBatchesLost(count: number): void {
    this.trace.push({ kind: 'gap', batches: count });
    this.set({ lostBatches: this.state.lostBatches + count, traceVersion: this.trace.version });
  }

  private onChannelStatus(status: ChannelStatus): void {
    this.set({ channels: this.state.channels.map((c) => (c.channel === status.channel ? status : c)) });
  }

  /** Clears the trace and the tallies that describe it (frames reported dropped, batches lost). Device counters are separate. */
  clearTrace(): void {
    this.trace.clear();
    this.set({ traceVersion: this.trace.version, droppedReported: {}, lostBatches: 0 });
  }

  /** Zeroes the device's counters (get_statistics with reset), so they describe what happens from now on. */
  resetStatistics(): Promise<boolean> {
    return this.act(async (s) => {
      await s.statistics(undefined, true);
      const stats = await s.statistics();
      this.set({ statistics: stats.statistics });
    });
  }

  setCaptureChannels(channels: number[]): void {
    this.set({ captureChannels: channels });
  }

  // -- polling --------------------------------------------------------------------

  private startPolling(): void {
    this.stopPolling();
    const generation = this.generation;
    const poll = async () => {
      const session = this.session;
      if (!session || generation !== this.generation) return;
      try {
        const [channels, stats] = await Promise.all([session.channelStatus(), session.statistics()]);
        if (generation !== this.generation) return;
        this.set({ channels, statistics: stats.statistics });
      } catch {
        // A failed poll is not an event: a lost link arrives through the closed handler.
      }
    };
    void poll();
    this.pollTimer = setInterval(poll, this.env.statsIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private clearSlowTimer(): void {
    if (this.slowTimer) clearTimeout(this.slowTimer);
    this.slowTimer = null;
  }

  async refresh(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const [channels, stats] = await Promise.all([session.channelStatus(), session.statistics()]);
    this.set({ channels, statistics: stats.statistics });
  }

  // -- actions ----------------------------------------------------------------------

  private requireSession(): DeviceSession {
    if (!this.session) throw new ContractError('NOT_CONNECTED', 'not connected');
    return this.session;
  }

  /** Runs a device action; failures become plain-language messages instead of exceptions in the UI. */
  private async act(fn: (session: DeviceSession) => Promise<void>): Promise<boolean> {
    this.set({ busy: true, actionError: null });
    try {
      await fn(this.requireSession());
      return true;
    } catch (error) {
      if (error instanceof ContractError && error.code === 'DEVICE_DISCONNECTED') return false; // the closed notice explains it
      const code = error instanceof ContractError ? error.code : 'INTERNAL_ERROR';
      this.set({ actionError: describeErrorCode(code) });
      return false;
    } finally {
      this.set({ busy: false });
    }
  }

  setBitrate(channel: number, bitrate: number): Promise<boolean> {
    return this.act(async (s) => this.replaceChannel(await s.setBitrate(channel, bitrate)));
  }

  setTermination(channel: number, enabled: boolean): Promise<boolean> {
    return this.act(async (s) => this.replaceChannel(await s.setTermination(channel, enabled)));
  }

  private replaceChannel(status: ChannelStatus): void {
    this.set({ channels: this.state.channels.map((c) => (c.channel === status.channel ? status : c)) });
  }

  startCapture(): Promise<boolean> {
    const selected = this.state.channels.filter((c) => this.state.captureChannels.includes(c.channel));
    const eligible = selected.filter((c) => c.bitrate !== null).map((c) => c.channel);
    if (!selected.length) {
      this.set({ actionError: 'Choose at least one channel to capture.' });
      return Promise.resolve(false);
    }
    if (!eligible.length) {
      this.set({ actionError: 'Set a bit rate on at least one selected channel before capturing.' });
      return Promise.resolve(false);
    }
    return this.act(async (s) => {
      const updated = await s.startRx(eligible, true);
      this.set({ capturing: true, channels: this.state.channels.map((c) => updated.find((u) => u.channel === c.channel) ?? c) });
    });
  }

  stopCapture(): Promise<boolean> {
    return this.act(async (s) => {
      const updated = await s.stopRx(this.state.channels.filter((c) => c.streaming).map((c) => c.channel));
      this.set({ capturing: false, channels: this.state.channels.map((c) => updated.find((u) => u.channel === c.channel) ?? c) });
      await this.refresh();
    });
  }

  async transmit(frame: TxFrame): Promise<boolean> {
    const session = this.session;
    const entry = (ok: boolean, message: string): void => {
      const log = [{ id: ++this.txCounter, frame, ok, message }, ...this.state.txLog].slice(0, 20);
      this.set({ txLog: log });
    };
    if (!session) {
      entry(false, describeErrorCode('NOT_CONNECTED'));
      return false;
    }
    try {
      await session.transmit(frame);
      entry(true, `Sent ${bytesToHex(frame.data, ' ').toUpperCase() || 'remote request'}`);
      return true;
    } catch (error) {
      const code = error instanceof ContractError ? error.code : 'INTERNAL_ERROR';
      entry(false, describeErrorCode(code));
      return false;
    }
  }
}
