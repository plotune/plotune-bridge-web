import { describe, expect, it } from 'vitest';
import { DBC_STORAGE_KEY, DbcRegistry, safeFileName, type DbcStorage } from '../src/dbc/registry';
import { readDbcFile } from '../src/dbc/readFile';

const DBC = 'BO_ 2024 Resp: 2 X\n SG_ Counter : 0|8@1+ (1,0) [0|255] "" Y\n SG_ Marker : 8|8@1+ (1,0) [0|255] "" Y\nVAL_ 2024 Marker 170 "Alive" ;\n';

function memory(initial: string | null = null): DbcStorage & { value: string | null; writes: number } {
  const store = {
    value: initial,
    writes: 0,
    get: () => store.value,
    set: (v: string) => {
      store.value = v;
      store.writes += 1;
    },
    remove: () => {
      store.value = null;
    },
  };
  return store;
}

describe('DbcRegistry', () => {
  it('assigns one database per channel, independently, and decodes frames of that channel only', () => {
    const registry = new DbcRegistry();
    expect(registry.assign(1, 'one.dbc', DBC)).toEqual({ ok: true, warnings: [] });
    expect(registry.message(1, 2024, false)?.name).toBe('Resp');
    expect(registry.message(2, 2024, false)).toBeUndefined();
    const decoded = registry.decode(1, 2024, false, Uint8Array.of(7, 0xaa));
    expect(decoded?.signals.map((s) => [s.name, s.value, s.label])).toEqual([['Counter', 7, undefined], ['Marker', 170, 'Alive']]);
    registry.remove(1);
    expect(registry.message(1, 2024, false)).toBeUndefined();
    expect(registry.getSnapshot()).toEqual([]);
  });

  it('says why a bad file was refused, keeps what was loaded, and tells subscribers only about real changes', () => {
    const registry = new DbcRegistry();
    let changes = 0;
    registry.subscribe(() => changes++);
    registry.assign(1, 'ok.dbc', DBC);
    expect(registry.assign(1, 'bad.dbc', 'not a database')).toEqual({ ok: false, message: expect.stringMatching(/No messages found/) });
    expect(registry.for(1)?.fileName).toBe('ok.dbc');
    expect(changes).toBe(1);
  });

  it('searches by message and signal names, lower-case', () => {
    const registry = new DbcRegistry();
    registry.assign(1, 'a.dbc', DBC);
    expect(registry.searchText(1, 2024, false)).toBe('resp counter marker');
    expect(registry.searchText(1, 1, false)).toBe('');
    expect(registry.searchText(2, 2024, false)).toBe('');
  });

  it('remembers files in this browser and restores them, parsed again', () => {
    const storage = memory();
    const first = new DbcRegistry(storage);
    first.assign(2, 'C:\\fakepath\\car.dbc', DBC);
    expect(JSON.parse(storage.value!).files[0]).toMatchObject({ channel: 2, fileName: 'car.dbc' });
    const second = new DbcRegistry(storage);
    expect(second.for(2)?.fileName).toBe('car.dbc');
    expect(second.message(2, 2024, false)?.name).toBe('Resp');
    second.remove(2);
    expect(storage.value).toBeNull();
  });

  it('ignores damaged or oversized remembered values and never throws', () => {
    for (const bad of ['not json', '{"version":2,"files":[]}', '{"version":1,"files":"x"}', JSON.stringify({ version: 1, files: [{ channel: 99, fileName: 'a', text: DBC }, { channel: 1, fileName: 5, text: DBC }, { channel: 1, fileName: 'x', text: 'garbage' }] })]) {
      expect(new DbcRegistry(memory(bad)).getSnapshot()).toEqual([]);
    }
  });

  it('keeps a very large set for this session only instead of filling the storage', () => {
    const storage = memory();
    const registry = new DbcRegistry(storage);
    const big = DBC + 'CM_ "' + 'x'.repeat(2_100_000) + '";\n';
    expect(registry.assign(1, 'big.dbc', big).ok).toBe(true);
    expect(storage.value).toBeNull();
    expect(registry.for(1)).toBeDefined();
  });

  it('survives a storage that throws', () => {
    const broken: DbcStorage = { get: () => { throw new Error('blocked'); }, set: () => { throw new Error('quota'); }, remove: () => { throw new Error('blocked'); } };
    const registry = new DbcRegistry(broken);
    expect(registry.assign(1, 'a.dbc', DBC).ok).toBe(true);
    expect(registry.for(1)).toBeDefined();
  });

  it('uses a fixed storage key', () => {
    expect(DBC_STORAGE_KEY).toBe('bw.dbc');
  });
});

describe('safeFileName', () => {
  it('keeps the name only: no path, no control characters, bounded', () => {
    expect(safeFileName('C:\\Users\\me\\car.dbc')).toBe('car.dbc');
    expect(safeFileName('/tmp/a/b.dbc')).toBe('b.dbc');
    expect(safeFileName('a\u0000b\nc.dbc')).toBe('abc.dbc');
    expect(safeFileName('x'.repeat(300)).length).toBe(100);
    expect(safeFileName('')).toBe('database.dbc');
  });
});

describe('readDbcFile', () => {
  const fileOf = (bytes: Uint8Array) => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  it('reads UTF-8, and falls back to Windows-1252 for files saved that way', async () => {
    expect(await readDbcFile(fileOf(new TextEncoder().encode('BO_ 1 Ü: 1 X')))).toEqual({ ok: true, text: 'BO_ 1 Ü: 1 X' });
    expect(await readDbcFile(fileOf(Uint8Array.of(0x43, 0x4d, 0x5f, 0x20, 0xfc)))).toEqual({ ok: true, text: 'CM_ ü' });
  });
  it('refuses a file over 5 MB without reading it, and reports a read failure in plain words', async () => {
    const huge = { size: 6 * 1024 * 1024, arrayBuffer: async () => { throw new Error('must not be read'); } };
    expect(await readDbcFile(huge)).toEqual({ ok: false, message: expect.stringMatching(/larger than 5 MB/) });
    expect(await readDbcFile({ size: 10, arrayBuffer: async () => { throw new Error('io'); } })).toEqual({ ok: false, message: 'This file could not be read.' });
  });
});
