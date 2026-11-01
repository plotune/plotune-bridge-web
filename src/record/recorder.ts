import { formatRelativeNs } from '../lib/bytes';
import type { CanFrame } from '../protocol/types';
import type { StreamTap, WorkspaceStore } from '../state/store';
import { BLF_OBJECT_SIZE, blfCanMessage, buildBlf, buildBlfBytes } from './blf';
import { formatSpec, type FormatSpec, type RecordFormat } from './formats';

/** Browsers without streaming to disk keep the recording in memory, so it is bounded. */
export const DEFAULT_CAP_BYTES = 64 * 1024 * 1024;

/**
 * Writes every frame it is given, in order, in one file format. It reads the stream itself, not the trace, so it does not
 * lose frames when the trace's bounded buffer wraps. Frames the device reported lost are counted, and written into
 * formats that can carry a note.
 */
export class Recorder implements StreamTap {
  readonly spec: FormatSpec;
  frames = 0;
  bytes = 0;
  dropped = 0;
  /** True once the size cap was reached: the recording stopped writing and should be saved. */
  capped = false;
  running = true;
  private origin: bigint | null = null;
  private lastNs: bigint | null = null;
  private readonly chunks: string[] = [];
  private readonly objects: Uint8Array[] = [];

  constructor(format: RecordFormat, readonly startedAt: Date, readonly capBytes = DEFAULT_CAP_BYTES) {
    this.spec = formatSpec(format);
    if (!this.spec.binary) this.write(this.spec.header(startedAt));
  }

  /** Seconds of device time between the first and the last recorded frame. */
  get durationS(): number {
    return this.origin === null || this.lastNs === null ? 0 : Number(this.lastNs - this.origin) / 1e9;
  }

  frame(frame: CanFrame): void {
    if (!this.running) return;
    this.origin ??= frame.timestampNs;
    this.lastNs = frame.timestampNs;
    if (this.spec.binary) {
      if (!this.reserve(BLF_OBJECT_SIZE)) return;
      this.objects.push(blfCanMessage(frame, frame.timestampNs - this.origin));
    } else if (!this.write(this.spec.line(frame, formatRelativeNs(frame.timestampNs, this.origin)))) return;
    this.frames += 1;
  }

  drop(channel: number, count: number): void {
    if (!this.running) return;
    this.dropped += count;
    const time = this.origin === null || this.lastNs === null ? '0.000000' : formatRelativeNs(this.lastNs, this.origin);
    this.write(this.spec.dropLine(channel, count, time));
  }

  /** Counts `size` bytes unless they would pass the cap; at the cap the recording stops and says so. */
  private reserve(size: number): boolean {
    if (this.bytes + size > this.capBytes) {
      this.capped = true;
      this.running = false;
      return false;
    }
    this.bytes += size;
    return true;
  }

  private write(text: string): boolean {
    if (text === '') return true;
    if (!this.reserve(text.length)) return false;
    this.chunks.push(text);
    return true;
  }

  /** Ends the recording and returns the file. (Binary formats are compressed here, so this is asynchronous.) */
  async stop(): Promise<Blob> {
    this.running = false;
    if (this.spec.binary) return buildBlf(this.objects, this.startedAt, new Date());
    return new Blob(this.chunks, { type: `${this.spec.mime};charset=utf-8` });
  }

  /** The BLF file as bytes (BLF recordings only), for tests. */
  blfBytes(): Promise<Uint8Array> {
    return buildBlfBytes(this.objects, this.startedAt, new Date());
  }

  /** The file as text, for tests. */
  text(): string {
    return this.chunks.join('');
  }
}

export interface RecordingSummary {
  fileName: string;
  frames: number;
  bytes: number;
  dropped: number;
  capped: boolean;
  carriesDrops: boolean;
}

export const recordingFileName = (d: Date, extension: string): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `bridge-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${extension}`;
};

/** Holds the one running recording, so it survives switching between pages of the workspace. */
export class RecordingService {
  current: Recorder | null = null;
  last: RecordingSummary | null = null;
  private store: WorkspaceStore | null = null;
  private readonly listeners = new Set<() => void>();
  /** Changes whenever a recording starts or stops. */
  version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = (): number => this.version;

  start(store: WorkspaceStore, format: RecordFormat, now = new Date()): void {
    void this.finish();
    const recorder = new Recorder(format, now);
    store.taps.add(recorder);
    this.store = store;
    this.current = recorder;
    this.last = null;
    this.changed();
  }

  /** Ends the recording and returns the file to save. */
  async stop(now = new Date()): Promise<{ blob: Blob; summary: RecordingSummary } | null> {
    const recorder = this.current;
    if (!recorder) return null;
    const blob = await this.finish();
    const summary: RecordingSummary = { fileName: recordingFileName(now, recorder.spec.extension), frames: recorder.frames, bytes: recorder.bytes, dropped: recorder.dropped, capped: recorder.capped, carriesDrops: recorder.spec.carriesDrops };
    this.last = summary;
    this.changed();
    return blob ? { blob, summary } : null;
  }

  private async finish(): Promise<Blob | null> {
    const recorder = this.current;
    if (!recorder) return null;
    this.store?.taps.delete(recorder);
    this.store = null;
    this.current = null;
    return recorder.stop();
  }

  private changed(): void {
    this.version += 1;
    this.listeners.forEach((l) => l());
  }
}
