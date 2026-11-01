import type { CanFrame } from '../protocol/types';
import type { TraceBuffer } from '../state/trace';
import { rowMatches, type TraceFilter } from './traceFilter';

/**
 * The rows of a trace that pass a filter, kept up to date by looking only at rows that arrived since the last call.
 * Re-scanning a full 20,000-row trace on every incoming batch took about 50 ms; this costs time in proportion to
 * the new rows. Rows never change once pushed, so earlier answers stay valid until the filter, the databases that
 * supply names, or the buffer itself (cleared) change; rows that scrolled out of the buffer are dropped.
 */
export class IncrementalFilter {
  /** Absolute positions (rows ever pushed since the last clear), ascending. */
  private matched: number[] = [];
  private scanned = 0;
  private signature = '';
  private generation = -1;
  private namesKey: unknown = undefined;

  /**
   * Buffer indexes of the matching rows, oldest first. `namesKey` changes whenever `names` would answer differently.
   * `end` (an absolute position) freezes the view at an earlier point, for a paused trace; rows after it are not looked at.
   */
  update(trace: TraceBuffer, filter: TraceFilter, names: ((frame: CanFrame) => string) | undefined, namesKey: unknown, end?: number): number[] {
    const signature = `${filter.text.trim().toLowerCase()}\u0000${filter.channel ?? ''}\u0000${filter.direction ?? ''}`;
    const evicted = trace.evicted;
    if (this.generation !== trace.generation || this.signature !== signature || this.namesKey !== namesKey) {
      this.matched = [];
      this.scanned = evicted;
      this.generation = trace.generation;
      this.signature = signature;
      this.namesKey = namesKey;
    }
    let drop = 0;
    while (drop < this.matched.length && this.matched[drop] < evicted) drop += 1;
    if (drop > 0) this.matched.splice(0, drop);
    const limit = Math.min(end ?? Infinity, evicted + trace.length);
    for (let absolute = Math.max(this.scanned, evicted); absolute < limit; absolute += 1) {
      if (rowMatches(trace.at(absolute - evicted), filter, names)) this.matched.push(absolute);
    }
    this.scanned = Math.max(this.scanned, limit);
    return this.matched.map((absolute) => absolute - evicted);
  }
}
