import { decodeMessage, indexMessages } from './decode';
import { MAX_DBC_BYTES, parseDbc } from './parse';
import { DbcError, type Dbc, type DbcMessage, type DecodedSignal } from './types';

export const DBC_STORAGE_KEY = 'bw.dbc';
/** Remembered files together must stay well inside the browser's storage quota; larger sets stay for this session only. */
const MAX_REMEMBERED_CHARS = 2_000_000;

export interface DbcAssignment {
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

/**
 * One DBC per CAN channel, held in this page and remembered in the browser. Files are read locally and never uploaded.
 * The assignment is by channel number: CAN1 and CAN2 are independent, and every device on the page uses the same ones.
 */
export class DbcRegistry {
  private items: DbcAssignment[] = [];
  private raw = new Map<number, { fileName: string; text: string }>();
  private readonly searchCache = new WeakMap<DbcMessage, string>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: DbcStorage | null = null) {
    this.restore();
  }

  getSnapshot = (): readonly DbcAssignment[] => this.items;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  for(channel: number): DbcAssignment | undefined {
    return this.items.find((a) => a.channel === channel);
  }

  assign(channel: number, fileName: string, text: string): AssignResult {
    let dbc: Dbc;
    try {
      dbc = parseDbc(text);
    } catch (error) {
      return { ok: false, message: error instanceof DbcError ? error.message : 'This file could not be read as a DBC.' };
    }
    const name = safeFileName(fileName);
    this.raw.set(channel, { fileName: name, text });
    this.items = [...this.items.filter((a) => a.channel !== channel), { channel, fileName: name, dbc, find: indexMessages(dbc) }].sort((a, b) => a.channel - b.channel);
    this.changed();
    return { ok: true, warnings: dbc.warnings };
  }

  remove(channel: number): void {
    this.raw.delete(channel);
    this.items = this.items.filter((a) => a.channel !== channel);
    this.changed();
  }

  /** The message a frame belongs to on this channel, or undefined: unknown frames keep showing raw data. */
  message(channel: number, id: number, extended: boolean): DbcMessage | undefined {
    return this.for(channel)?.find(id, extended);
  }

  /** Lower-case message and signal names of a frame's message, for filtering. Empty when the frame is not in a database. */
  searchText(channel: number, id: number, extended: boolean): string {
    const message = this.message(channel, id, extended);
    if (!message) return '';
    let text = this.searchCache.get(message);
    if (text === undefined) {
      text = [message.name, ...message.signals.map((signal) => signal.name)].join(' ').toLowerCase();
      this.searchCache.set(message, text);
    }
    return text;
  }

  decode(channel: number, id: number, extended: boolean, data: Uint8Array): { message: DbcMessage; signals: DecodedSignal[] } | undefined {
    const message = this.message(channel, id, extended);
    return message ? { message, signals: decodeMessage(message, data) } : undefined;
  }

  private changed(): void {
    this.persist();
    this.listeners.forEach((listener) => listener());
  }

  private persist(): void {
    if (!this.storage) return;
    const files = [...this.raw].map(([channel, f]) => ({ channel, fileName: f.fileName, text: f.text }));
    const size = files.reduce((n, f) => n + f.text.length, 0);
    try {
      if (files.length === 0 || size > MAX_REMEMBERED_CHARS) this.storage.remove();
      else this.storage.set(JSON.stringify({ version: 1, files }));
    } catch {
      // storage unavailable or full: the files stay for this session only
    }
  }

  private restore(): void {
    if (!this.storage) return;
    try {
      const stored = this.storage.get();
      if (!stored) return;
      const parsed: unknown = JSON.parse(stored);
      const files = (parsed as { version?: number; files?: unknown })?.files;
      if ((parsed as { version?: number })?.version !== 1 || !Array.isArray(files)) return;
      for (const f of files.slice(0, 8)) {
        const entry = f as { channel?: unknown; fileName?: unknown; text?: unknown };
        if (!Number.isInteger(entry.channel) || typeof entry.fileName !== 'string' || typeof entry.text !== 'string' || entry.text.length > MAX_DBC_BYTES) continue;
        const channel = entry.channel as number;
        if (channel < 1 || channel > 8) continue;
        this.assignQuietly(channel, entry.fileName, entry.text);
      }
    } catch {
      // a damaged remembered value is ignored
    }
  }

  private assignQuietly(channel: number, fileName: string, text: string): void {
    try {
      const dbc = parseDbc(text);
      const name = safeFileName(fileName);
      this.raw.set(channel, { fileName: name, text });
      this.items = [...this.items, { channel, fileName: name, dbc, find: indexMessages(dbc) }].sort((a, b) => a.channel - b.channel);
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
