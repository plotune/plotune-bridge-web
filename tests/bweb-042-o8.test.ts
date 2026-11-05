// BWEB-042 rev 1 / O8 — call-site regressions for "direct targets require an explicit port".
// parseTarget itself is covered in tests/lib.test.ts; here we prove the two call sites stay honest and that a
// legacy saved address without a port does not crash the app (it degrades to a clean, usable shell).
import { describe, expect, it, vi } from 'vitest';
import { rememberableTarget, WorkspacePersistence, WORKSPACE_KEY, emptyWorkspace } from '../src/state/persistence';
import { WorkspaceStore, defaultEnv } from '../src/state/store';
import type { TransportFactory } from '../src/transport/types';

const MISSING_PORT = 'Add the port, for example 192.168.1.50:9101.';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
}

describe('O8: a saved address without a port does not crash the app', () => {
  it.each(['192.168.1.50', 'ws://192.168.1.50', 'wss://192.168.1.50'])('rememberableTarget(%j) returns null, never throws', (target) => {
    expect(() => rememberableTarget(target)).not.toThrow();
    expect(rememberableTarget(target)).toBeNull();
  });
  it('an address with a port is still remembered', () => {
    expect(rememberableTarget('192.168.1.50:9101')).toBe('ws://192.168.1.50:9101');
    expect(rememberableTarget('wss://192.168.1.50:9443')).toBe('wss://192.168.1.50:9443');
  });
  it('a stored workspace whose device has no port loads as a clean shell (no exception, no device)', () => {
    const storage = memory();
    storage.setItem(WORKSPACE_KEY, JSON.stringify({
      ...emptyWorkspace(),
      devices: [{ id: 'd1', label: 'Bridge 1', target: '192.168.1.50', captureChannels: [1, 2], transmitChannel: 1 }],
      activeId: 'd1', permissionExplained: true,
    }));
    const persistence = new WorkspacePersistence(() => storage);
    expect(() => persistence.load()).not.toThrow();
    const loaded = persistence.load();
    expect(loaded.devices).toEqual([]);
    expect(loaded.page).toBe('capture');
  });
});

describe('O8: the store surfaces the validation error and never opens a wrong-port connection', () => {
  it.each(['192.168.1.50', 'ws://192.168.1.50', 'wss://192.168.1.50'])('connect(%j) is blocked with the port hint and opens nothing', async (address) => {
    // If a transport is requested the test fails: a bare host must never reach ws://host:80.
    const transportFactory: TransportFactory = vi.fn(() => { throw new Error('must not open a transport'); });
    const store = new WorkspaceStore(defaultEnv({
      transportFactory,
      browser: { family: 'chromium', name: 'Chrome', supported: true },
      queryPermission: async () => 'unknown',
      pageIsSecure: true,
    }));
    await store.connect(address);
    const state = store.getState();
    expect(state.phase).toBe('closed');
    expect(state.notice?.kind).toBe('blocked-by-browser');
    expect(state.notice?.summary).toBe(MISSING_PORT);
    expect(state.notice?.title).toBe('Check the device address');
    expect(transportFactory).not.toHaveBeenCalled();
  });
});
