import { describe, expect, it } from 'vitest';
import { DbcRegistry } from '../src/dbc/registry';
import { ProjectStore } from '../src/workspace/project';
import { exportWorkspace, importWorkspace, relinkDatabase } from '../src/workspace/references';

const dbc = 'BO_ 100 Sample: 1 ECU\n SG_ Value : 0|8@1+ (1,0) [0|255] "V" ECU\n';

describe('BWEB-010 r2 portable local workspace references', () => {
  it('round-trips configuration and references, never DBC bytes, and requests missing/mismatched files', async () => {
    const first = new ProjectStore(() => null);
    first.addPanel('stats');
    const databases = new DbcRegistry();
    databases.assign('Bridge 1', 1, 'bench.dbc', dbc);
    const json = await exportWorkspace(first, databases);
    expect(json).not.toContain('BO_');
    expect(JSON.parse(json).databaseReferences[0]).toMatchObject({ source: 'Bridge 1', channel: 1, fileName: 'bench.dbc', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const second = new ProjectStore(() => null);
    const local = new DbcRegistry();
    expect(importWorkspace(second, json).ok).toBe(true);
    expect(Object.values(second.getState().project.panels)[0]?.type).toBe('stats');
    const ref = second.getState().project.databaseReferences![0]!;
    expect(local.for(ref.source, ref.channel)).toBeUndefined();
    expect((await relinkDatabase(local, ref, 'bench.dbc', dbc.replace('Sample', 'Other'))).ok).toBe(false);
    expect(local.for(ref.source, ref.channel)).toBeUndefined();
    expect((await relinkDatabase(local, ref, 'bench.dbc', dbc)).ok).toBe(true);
    expect(local.message('Bridge 1', 1, 100, false)?.name).toBe('Sample');
  });

  it('preserves unresolved references on re-export and ignores log-only databases', async () => {
    const store = new ProjectStore(() => null);
    const registry = new DbcRegistry();
    registry.assign('Bridge 1', 2, 'bench.dbc', dbc);
    registry.assign('log:r1', 1, 'local.dbc', dbc);
    const portable = await exportWorkspace(store, registry);
    const target = new ProjectStore(() => null);
    importWorkspace(target, portable);
    expect(JSON.parse(await exportWorkspace(target, new DbcRegistry())).databaseReferences).toEqual(JSON.parse(portable).databaseReferences);
    expect(JSON.parse(portable).databaseReferences).toHaveLength(1);
    const wrong = new DbcRegistry();
    wrong.assign('Bridge 1', 2, 'bench.dbc', dbc.replace('Sample', 'Wrong'));
    expect(JSON.parse(await exportWorkspace(target, wrong)).databaseReferences).toEqual(JSON.parse(portable).databaseReferences);
  });

  it('rejects malformed references atomically and retains legacy version-2 imports', () => {
    const store = new ProjectStore(() => null);
    const before = store.exportJson();
    const bad = { ...JSON.parse(before), databaseReferences: [{ source: 'Bridge 1', channel: 1, fileName: 'x.dbc', sha256: 'wrong', text: dbc }] };
    expect(importWorkspace(store, JSON.stringify(bad)).ok).toBe(false);
    expect(store.exportJson()).toBe(before);
    expect(importWorkspace(store, before).ok).toBe(true);
  });
});

describe('PR71 review regressions', () => {
  it('blocks mismatched decoding immediately, restores matching bindings and keeps unrelated channels usable', async () => {
    const registry = new DbcRegistry();
    registry.assign('Bridge 1', 1, 'bench.dbc', dbc);
    registry.assign('Bridge 1', 2, 'other.dbc', dbc);
    const [ref] = await registry.references();
    registry.assign('Bridge 1', 1, 'bench.dbc', dbc.replace('(1,0)', '(5,0)'));
    const checking = registry.applyReferences([ref!]);
    expect(registry.decode('Bridge 1', 1, 100, false, Uint8Array.of(2))).toBeUndefined();
    expect(registry.for('Bridge 1', 2)).toBeDefined();
    await checking;
    expect(registry.getSnapshot().some((a) => a.channel === 1)).toBe(false);
    await relinkDatabase(registry, ref!, 'bench.dbc', dbc);
    expect(registry.decode('Bridge 1', 1, 100, false, Uint8Array.of(2))?.signals[0]?.value).toBe(2);
    await registry.applyReferences([]);
    expect(registry.for('Bridge 1', 1)).toBeDefined();
  });
  it('normalizes selected names like the ordinary database picker', async () => {
    const registry = new DbcRegistry();
    const long = 'x'.repeat(105) + '.dbc';
    registry.assign('Bridge 1', 1, long, dbc);
    const [ref] = await registry.references();
    expect((await relinkDatabase(new DbcRegistry(), ref!, long, dbc)).ok).toBe(true);
  });
  it('refuses an export whose merged reference list exceeds its own import limit', async () => {
    const store = new ProjectStore(() => null);
    const refs = Array.from({ length: 64 }, (_, i) => ({ source: 'Bridge 1', channel: i + 1, fileName: 'x.dbc', sha256: 'a'.repeat(64) }));
    importWorkspace(store, JSON.stringify({ ...JSON.parse(store.exportJson()), databaseReferences: refs }));
    const local = new DbcRegistry();
    local.assign('Bridge 2', 1, 'new.dbc', dbc);
    await expect(exportWorkspace(store, local)).rejects.toThrow(/64/);
  });
});
