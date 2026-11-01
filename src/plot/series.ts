import type { DbcRegistry } from '../dbc/registry';
import { decodeSelected } from '../dbc/decode';
import type { TraceBuffer } from '../state/trace';

/** A signal to plot: which channel's database message and signal, with what the database says about its unit. */
export interface SignalKey {
  channel: number;
  id: number;
  extended: boolean;
  /** The signal name inside the message. */
  signal: string;
  /** For display only. */
  messageName: string;
  unit: string;
}

export const signalId = (k: Pick<SignalKey, 'channel' | 'id' | 'extended' | 'signal'>): string => `${k.channel}:${k.extended ? 'x' : 's'}${k.id}:${k.signal}`;

/** Points of one signal, oldest first. Time is seconds on the device's own clock, counted from its first frame. */
export class Series {
  /** Ring storage; `start` is the index of the oldest point. */
  private t: Float64Array;
  private v: Float64Array;
  private start = 0;
  length = 0;
  /** Counts every accepted push, so a drawing can tell that something changed. */
  version = 0;

  constructor(readonly key: SignalKey, readonly capacity: number) {
    this.t = new Float64Array(capacity);
    this.v = new Float64Array(capacity);
  }

  push(time: number, value: number): void {
    const slot = (this.start + this.length) % this.capacity;
    this.t[slot] = time;
    this.v[slot] = value;
    if (this.length < this.capacity) this.length += 1;
    else this.start = (this.start + 1) % this.capacity;
    this.version += 1;
  }

  timeAt(i: number): number {
    return this.t[(this.start + i) % this.capacity];
  }

  valueAt(i: number): number {
    return this.v[(this.start + i) % this.capacity];
  }

  /** The index of the first point whose time is >= `time` (length when none). Times only ever increase. */
  lowerBound(time: number): number {
    let lo = 0;
    let hi = this.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.timeAt(mid) < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The point nearest to `time`, or null when the series is empty. */
  nearest(time: number): { time: number; value: number } | null {
    if (this.length === 0) return null;
    const i = this.lowerBound(time);
    const candidates = [i - 1, i].filter((n) => n >= 0 && n < this.length);
    let best = candidates[0];
    for (const n of candidates) if (Math.abs(this.timeAt(n) - time) < Math.abs(this.timeAt(best) - time)) best = n;
    return { time: this.timeAt(best), value: this.valueAt(best) };
  }

  clear(): void {
    this.start = 0;
    this.length = 0;
    this.version += 1;
  }
}

/**
 * Collects samples of the chosen signals from a trace, looking only at rows that arrived since the last call. Samples are
 * copied out, so rows leaving the trace's own buffer do not remove them from the plot. Starts over when the trace is
 * cleared or the databases change (a name or a scaling may differ).
 */
export class SeriesStore {
  private readonly series = new Map<string, Series>();
  private scanned = 0;
  private generation = -1;
  private databaseKey: unknown = undefined;
  /** Rows that left the trace's buffer before this store had read them. Their samples are lost; the plot says so. */
  missed = 0;

  constructor(private readonly capacity = 60_000) {}

  /** The series for the selection, in selection order. Creates, keeps or drops series to match. */
  sync(keys: readonly SignalKey[]): Series[] {
    const wanted = new Set(keys.map(signalId));
    for (const id of [...this.series.keys()]) if (!wanted.has(id)) this.series.delete(id);
    return keys.map((key) => {
      const id = signalId(key);
      let s = this.series.get(id);
      if (!s) {
        s = new Series(key, this.capacity);
        this.series.set(id, s);
        // A new signal needs the rows already in the trace too: the next update clears every series and reads them all again.
        this.generation = -1;
      }
      return s;
    });
  }

  /** Reads rows of `trace` not yet seen, up to the absolute position `end` (a paused plot passes its freeze point). */
  update(trace: TraceBuffer, registry: DbcRegistry, databaseKey: unknown, end?: number): void {
    if (this.series.size === 0) return;
    const evicted = trace.evicted;
    if (this.generation !== trace.generation || this.databaseKey !== databaseKey) {
      for (const s of this.series.values()) s.clear();
      this.scanned = evicted;
      this.generation = trace.generation;
      this.databaseKey = databaseKey;
      this.missed = 0;
    } else if (this.scanned < evicted) {
      this.missed += evicted - this.scanned;
    }
    // Which signal names to read from which message.
    const byMessage = new Map<string, { names: Set<string>; series: Map<string, Series> }>();
    for (const s of this.series.values()) {
      const k = s.key;
      const mk = `${k.channel}:${k.extended ? 'x' : 's'}${k.id}`;
      let entry = byMessage.get(mk);
      if (!entry) byMessage.set(mk, (entry = { names: new Set(), series: new Map() }));
      entry.names.add(k.signal);
      entry.series.set(k.signal, s);
    }
    const limit = Math.min(end ?? Infinity, evicted + trace.length);
    for (let absolute = Math.max(this.scanned, evicted); absolute < limit; absolute += 1) {
      const row = trace.at(absolute - evicted);
      if (row.kind !== 'frame' || row.frame.rtr) continue;
      const f = row.frame;
      const entry = byMessage.get(`${f.channel}:${f.extended ? 'x' : 's'}${f.id}`);
      if (!entry) continue;
      const message = registry.message(f.channel, f.id, f.extended);
      if (!message) continue;
      const origin = row.originNs ?? trace.originNs ?? f.timestampNs;
      const time = Number(f.timestampNs - origin) / 1e9;
      for (const decoded of decodeSelected(message, f.data, entry.names)) entry.series.get(decoded.name)?.push(time, decoded.value);
    }
    this.scanned = Math.max(this.scanned, limit);
  }
}
