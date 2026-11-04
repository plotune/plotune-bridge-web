import { fingerprint, type DatabaseReference } from './references';
import { decodeMessage, indexMessages } from './decode';
import { MAX_DBC_BYTES, parseDbc } from './parse';
import { DbcError, type Dbc, type DbcMessage, type DecodedSignal } from './types';

export const DBC_STORAGE_KEY = 'bw.dbc';
/** Remembered files together must stay well inside the browser's storage quota; larger sets stay for this session only. */
const MAX_REMEMBERED_CHARS = 3_000_000;
const MAX_REMEMBERED_FILES = 32;

export interface DbcAssignment {
  /** Whose channel this is: a device's label ("Bridge 2"), or a log file ("log:<id>"). */
  source: string;
  channel: number;
  fileName: string;
  dbc: Dbc;
  find(id: number, extended: boolean): DbcMessage | undefined;
}

export interface DbcStorage {
  get(): string | null;
  set(value: string): void;
  remove(): void;
}

export type AssignResult = { ok: true; warnings: string[] } | { ok: false; message: string };

/** The file name only: no path, no control characters, bounded. It is shown to the user and remembered. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) || 'database.dbc';
}

/** The source old remembered files belong to: before databases were linked to devices there was one set, used by every device. */
export const LEGACY_SOURCE = 'Bridge 1';

/**
 * One DBC per channel of a source, held in this page and remembered in the browser. Files are read locally and never uploaded.
 * A source is a device (so two identical Bridges have their own CAN1 and CAN2) or a log file opened for analysis.
 */
export class DbcRegistry {
  private items: DbcAssignment[] = [];
  private raw = new Map<string, { source: string; channel: number; fileName: string; text: string }>();
  private visible: DbcAssignment[] = [];
  private expected: readonly DatabaseReference[] = [];
  private validated = new Map<string, unknown>();
  private referenceGeneration = 0;

  /** Reject first; asynchronous hashing may only re-enable a binding from this exact generation. */
  async applyReferences(refs: readonly DatabaseReference[]): Promise<void> {
    this.expected = refs;
    const generation = ++this.referenceGeneration;
    this.validated.clear();
    this.refresh();
    await Promise.all(refs.map(async (ref) => {
      const key = DbcRegistry.key(ref.source, ref.channel);
      const file = this.raw.get(key);
      if (!file || file.fileName !== ref.fileName) return;
      try {
        const hash = await fingerprint(file.text);
        if (generation !== this.referenceGeneration || this.raw.get(key) !== file || hash !== ref.sha256) return;
        this.validated.set(key, file);
      } catch { /* unavailable crypto leaves the reference unresolved */ }
    }));
    if (generation === this.referenceGeneration) this.refresh();
  }

  recheckReferences(): Promise<void> { return this.applyReferences(this.expected); }

  private allowed(source: string, channel: number): boolean {
    const bound = this.expected.some((r) => r.source === source && r.channel === channel);
    const key = DbcRegistry.key(source, channel);
    return !bound || this.validated.get(key) === this.raw.get(key) && this.raw.has(key);
  }

  private refresh(): void {
    this.visible = this.items.filter((a) => this.allowed(a.source, a.channel));
    this.listeners.forEach((listener) => listener());
  }

  private readonly searchCache = new WeakMap<DbcMessage, string>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: DbcStorage | null = null) {
    this.restore();
    this.refresh();
  }

  async references(): Promise<DatabaseReference[]> {
    const files = [...this.raw.values()].filter((f) => !f.source.startsWith('log:'));
    return Promise.all(files.map(async (f) => ({ source: f.source, channel: f.channel, fileName: f.fileName, sha256: await fingerprint(f.text) })));
  }

  getSnapshot = (): readonly DbcAssignment[] => this.visible;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  for(source: string, channel: number): DbcAssignment | undefined {
    return this.visible.find((a) => a.channel === channel && a.source === source);
  }

  /** Every assignment of one source. */
  of(source: string): DbcAssignment[] {
    return this.visible.filter((a) => a.source === source);
  }

  private static key(source: string, channel: number): string {
    return `${source}\u0000${channel}`;
  }

  private put(source: string, channel: number, fileName: string, text: string, dbc: Dbc): void {
    const name = safeFileName(fileName);
    this.raw.set(DbcRegistry.key(source, channel), { source, channel, fileName: name, text });
    this.items = [...this.items.filter((a) => !(a.channel === channel && a.source === source)), { source, channel, fileName: name, dbc, find: indexMessages(dbc) }].sort((a, b) => (a.source === b.source ? a.channel - b.channel : a.source < b.source ? -1 : 1));
  }

  assign(source: string, channel: number, fileName: string, text: string): AssignResult {
    let dbc: Dbc;
    try {
      dbc = parseDbc(text);
    } catch (error) {
      return { ok: false, message: error instanceof DbcError ? error.message : 'This file could not be read as a DBC.' };
    }
    this.put(source, channel, fileName, text, dbc);
    this.changed();
    return { ok: true, warnings: dbc.warnings };
  }

  /** Links the database already loaded on one channel to another channel too (the same file for CAN1 and CAN2, say). */
  copy(from: { source: string; channel: number }, to: { source: string; channel: number }): boolean {
    const f = this.raw.get(DbcRegistry.key(from.source, from.channel));
    const a = this.for(from.source, from.channel);
    if (!f || !a) return false;
    this.put(to.source, to.channel, f.fileName, f.text, a.dbc);
    this.changed();
    return true;
  }

  remove(source: string, channel: number): void {
    this.raw.delete(DbcRegistry.key(source, channel));
    this.items = this.items.filter((a) => !(a.channel === channel && a.source === source));
    this.changed();
  }

  /** Forgets every database of a source (a device that was removed, a log that was closed). */
  removeSource(source: string): void {
    for (const [k, v] of this.raw) if (v.source === source) this.raw.delete(k);
    const before = this.items.length;
    this.items = this.items.filter((a) => a.source !== source);
    if (this.items.length !== before) this.changed();
  }

  /** The message a frame belongs to on this channel, or undefined: unknown frames keep showing raw data. */
  message(source: string, channel: number, id: number, extended: boolean): DbcMessage | undefined {
    return this.for(source, channel)?.find(id, extended);
  }

  /** Lower-case message and signal names of a frame's message, for filtering. Empty when the frame is not in a database. */
  searchText(source: string, channel: number, id: number, extended: boolean): string {
    const message = this.message(source, channel, id, extended);
    if (!message) return '';
    let text = this.searchCache.get(message);
    if (text === undefined) {
      text = [message.name, ...message.signals.map((signal) => signal.name)].join(' ').toLowerCase();
      this.searchCache.set(message, text);
    }
    return text;
  }

  decode(source: string, channel: number, id: number, extended: boolean, data: Uint8Array): { message: DbcMessage; signals: DecodedSignal[] } | undefined {
    const message = this.message(source, channel, id, extended);
    return message ? { message, signals: decodeMessage(message, data) } : undefined;
  }

  private changed(): void {
    this.persist();
    if (this.expected.length) void this.recheckReferences();
    else this.refresh();
  }

  private persist(): void {
    if (!this.storage) return;
    const files = [...this.raw.values()].filter((f) => !f.source.startsWith('log:')).map((f) => ({ source: f.source, channel: f.channel, fileName: f.fileName, text: f.text }));
    const size = files.reduce((n, f) => n + f.text.length, 0);
    try {
      if (files.length === 0 || size > MAX_REMEMBERED_CHARS) this.storage.remove();
      else this.storage.set(JSON.stringify({ version: 2, files }));
    } catch {
      // storage unavailable or full: the files stay for this session only
    }
  }

  private restore(): void {
    if (!this.storage) return;
    try {
      const stored = this.storage.get();
      if (!stored) return;
      const parsed = JSON.parse(stored) as { version?: number; files?: unknown };
      const version = parsed?.version;
      if ((version !== 1 && version !== 2) || !Array.isArray(parsed.files)) return;
      for (const f of parsed.files.slice(0, MAX_REMEMBERED_FILES)) {
        const entry = f as { source?: unknown; channel?: unknown; fileName?: unknown; text?: unknown };
        if (!Number.isInteger(entry.channel) || typeof entry.fileName !== 'string' || typeof entry.text !== 'string' || entry.text.length > MAX_DBC_BYTES) continue;
        const channel = entry.channel as number;
        if (channel < 1 || channel > 64) continue;
        // Files remembered before databases were linked to devices belong to the first device.
        const source = typeof entry.source === 'string' && entry.source && !entry.source.startsWith('log:') ? entry.source.slice(0, 60) : LEGACY_SOURCE;
        if (version === 1 || typeof entry.source === 'string') this.assignQuietly(source, channel, entry.fileName, entry.text);
      }
    } catch {
      // a damaged remembered value is ignored
    }
  }

  private assignQuietly(source: string, channel: number, fileName: string, text: string): void {
    try {
      this.put(source, channel, fileName, text, parseDbc(text));
    } catch {
      // a remembered file that no longer parses is dropped
    }
  }
}

export function browserDbcStorage(): DbcStorage {
  return {
    get: () => {
      try {
        return localStorage.getItem(DBC_STORAGE_KEY);
      } catch {
        return null;
      }
    },
    set: (value) => localStorage.setItem(DBC_STORAGE_KEY, value),
    remove: () => {
      try {
        localStorage.removeItem(DBC_STORAGE_KEY);
      } catch {
        // nothing remembered to remove
      }
    },
  };
}
