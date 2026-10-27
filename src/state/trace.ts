import type { CanFrame } from '../protocol/types';

export type TraceRowBase =
  | { kind: 'frame'; key: number; frame: CanFrame }
  /** The device reported lost frames. Where in the stream they were lost is not known; this marks where the news arrived. */
  | { kind: 'drop'; key: number; channel: number; count: number }
  /** The transport lost whole batches (a gap in the stream sequence). */
  | { kind: 'gap'; key: number; batches: number }
  | { kind: 'session'; key: number; text: string };

/** In a merged trace every row also names the device it came from and that device's own time origin. */
export type TraceRow = TraceRowBase & { device?: string; originNs?: bigint };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Bounded trace. When full, the oldest rows leave the view and are counted in `evicted`, never silently.
 * Rows keep the device's channel, timestamp and direction exactly as received.
 */
export class TraceBuffer {
  private rows: TraceRow[] = [];
  private nextKey = 1;
  evicted = 0;
  version = 0;
  originNs: bigint | null = null;
  /** Called for every pushed row, so a merged view can follow this buffer. */
  onPush: ((row: TraceRow) => void) | null = null;

  constructor(readonly capacity = 20_000) {}

  get length(): number {
    return this.rows.length;
  }

  at(index: number): TraceRow {
    return this.rows[index];
  }

  push(row: DistributiveOmit<TraceRow, 'key'>): void {
    const full = { ...row, key: this.nextKey++ } as TraceRow;
    if (full.kind === 'frame' && this.originNs === null) this.originNs = full.frame.timestampNs;
    this.rows.push(full);
    // Trim in chunks so the per-frame cost stays constant.
    if (this.rows.length > this.capacity + Math.max(64, this.capacity >> 3)) {
      const excess = this.rows.length - this.capacity;
      this.rows.splice(0, excess);
      this.evicted += excess;
    }
    this.version += 1;
    this.onPush?.(full);
  }

  clear(): void {
    this.rows = [];
    this.evicted = 0;
    this.originNs = null;
    this.version += 1;
  }
}
