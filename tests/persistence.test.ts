import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePersistence, WORKSPACE_KEY, emptyWorkspace } from '../src/state/persistence';
import { DeviceHub } from '../src/state/hub';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { FakeTransport } from './helpers/fakes';
import { MockDeviceCore } from './helpers/mockDevice';

function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
}
const hubs: DeviceHub[] = [];
afterEach(() => { hubs.forEach((h) => h.getState().slots.forEach((s) => s.store.disconnect())); hubs.length = 0; });

function rig(storage = memory()) {
  const device = new MockDeviceCore();
  const transport = vi.fn((url: string) => new FakeTransport(url, device));
  const permission = vi.fn(async () => 'unknown' as const);
  const hub = new DeviceHub(() => new WorkspaceStore(defaultEnv({
    transportFactory: transport, queryPermission: permission, schedule: (fn) => fn(),
    browser: { family: 'chromium', name: 'Chrome', supported: true },
  })), (fn) => fn(), new WorkspacePersistence(() => storage));
  hubs.push(hub);
  return { hub, device, transport, permission, storage };
}

describe('workspace persistence', () => {
  it('restores view/devices/preferences disconnected and reads live channel state on reconnect', async () => {
    const r = rig();
    const slot = r.hub.addDevice()!;
    await slot.store.connect('localhost:9101');
    await slot.store.setBitrate(1, 500000);
    await slot.store.setTermination(1, true);
    slot.store.setCaptureChannels([1]);
    slot.store.setTransmitChannel(2);
    await slot.store.startCapture();
    r.hub.setPage('diagnostics');
    r.hub.setPanelVisible('capture', 'stats', false);
    r.hub.setDiagSettings({ udsRequestId: '701' });
    const saved = r.storage.data.get(WORKSPACE_KEY)!;
    expect(saved).not.toMatch(/bitrate|termination|streaming|sessionId|clock|"permission"|txLog|statistics/);
    slot.store.disconnect();
    const restored = rig(r.storage);
    expect(restored.hub.getState().page).toBe('diagnostics');
    expect(restored.hub.getState().slots).toHaveLength(1);
    expect(restored.hub.getState().hidden.capture).toEqual(['stats']);
    expect(restored.hub.getState().diagnostics.udsRequestId).toBe('701');
    expect(restored.hub.active.store.getState()).toMatchObject({ phase: 'closed', target: 'ws://localhost:9101', descriptor: null, channels: [], captureChannels: [1], transmitChannel: 2 });
    expect(restored.transport).not.toHaveBeenCalled();
    expect(restored.permission).not.toHaveBeenCalled();
    // A restored browser must use hello, not replay saved bit rate/armed settings.
    restored.device.channels[0].bitrate = 250000;
    restored.device.channels[0].termination = true;
    restored.device.channels[0].streaming = true;
    await restored.hub.active.store.connect('localhost:9101');
    expect(restored.hub.active.store.getState().channels[0]).toMatchObject({ bitrate: 250000, termination: true, streaming: true });
    expect(restored.hub.active.store.getState().capturing).toBe(true);
    expect(restored.device.requests.some((m) => ['set_bitrate', 'set_termination', 'start_rx'].includes(m.op as string))).toBe(false);
    expect(restored.hub.active.store.getState().captureChannels).toEqual([1]);
  });

  it.each(['{broken', '{"version":0}', '{"version":999}', '{"version":1,"devices":"bad"}', 'null'])('falls back to a clean shell for corrupt/unsupported storage %s', (value) => {
    const storage = memory(); storage.setItem(WORKSPACE_KEY, value);
    const r = rig(storage);
    expect(r.hub.getState()).toMatchObject({ slots: [], page: 'capture' });
    expect(r.transport).not.toHaveBeenCalled();
  });

  it('works when storage reads, writes or even its getter throw', () => {
    for (const getStorage of [() => { throw new Error('blocked'); }, () => ({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } })]) {
      const p = new WorkspacePersistence(getStorage);
      expect(p.load().devices).toEqual([]);
      expect(() => p.save({ ...emptyWorkspace(), page: 'device' })).not.toThrow();
    }
  });

  it('migrates the previous unversioned safe address, panel and diagnostic preferences', () => {
    const storage = memory();
    storage.setItem('bw.target', '127.0.0.1:9101');
    storage.setItem('bw.hidden.capture', '["stats"]');
    storage.setItem('bw.diagnostics', '{"udsRequestId":"705","securityKey":"never-copy"}');
    storage.setItem('bw.permissionExplained', '1');
    const p = new WorkspacePersistence(() => storage);
    expect(p.load()).toMatchObject({ version: 1, permissionExplained: true, devices: [{ target: 'ws://127.0.0.1:9101' }], hidden: { capture: ['stats'] }, diagnostics: { udsRequestId: '705' } });
    expect(storage.getItem(WORKSPACE_KEY)).not.toContain('never-copy');
    expect(storage.getItem('bw.target')).toBeNull();
  });

  it.each(['ws://user:password@localhost:9101', 'ws://localhost:9101?token=secret', 'wss://localhost/private-secret', 'ws://localhost/#secret'])('does not persist credentials or credential-bearing endpoints: %s', async (target) => {
    const r = rig();
    const slot = r.hub.addDevice()!;
    await slot.store.connect(target);
    expect(r.storage.data.get(WORKSPACE_KEY)).not.toMatch(/secret|password|token=/);
    expect(new WorkspacePersistence(() => r.storage).load().devices).toEqual([]);
  });

  it('forgets a removed device, keeps stable IDs and does not write storage for trace/poll updates', async () => {
    const r = rig();
    const first = r.hub.addDevice()!;
    await first.store.connect('localhost:9101');
    const second = r.hub.addDevice()!;
    await second.store.connect('localhost:9121');
    r.hub.select(first.id);
    r.hub.setTraceView(second.id);
    const write = vi.spyOn(r.storage, 'setItem');
    await first.store.refresh();
    expect(write).not.toHaveBeenCalled();
    const restored = rig(r.storage);
    expect(restored.hub.getState()).toMatchObject({ activeId: first.id, traceView: second.id });
    r.hub.removeDevice(first.id);
    expect(new WorkspacePersistence(() => r.storage).load().devices.map((d) => d.id)).toEqual([second.id]);
    r.hub.removeDevice(second.id);
    expect(new WorkspacePersistence(() => r.storage).load().devices).toEqual([]);
  });
});


it('scrubs unknown fields and secret-like legacy state from a supported saved record', () => {
  const storage = memory();
  storage.setItem(WORKSPACE_KEY, JSON.stringify({
    ...emptyWorkspace(),
    devices: [{ id: 'd3', label: 'synthetic-secret-label', target: 'ws://localhost:9101', bitrate: 500000, token: 'synthetic-secret-device' }],
    diagnostics: { channel: 2, udsRequestId: '702', securityKey: 'synthetic-secret-key', timeoutMs: -1 },
    access_token: 'synthetic-secret-account', hidden: { capture: ['stats', 'not-a-panel'] },
    page: 'not-a-view', activeId: 'missing', traceView: 'missing',
  }));
  const loaded = new WorkspacePersistence(() => storage).load();
  expect(loaded).toMatchObject({ page: 'capture', activeId: 'd3', traceView: 'all', hidden: { capture: ['stats'] }, diagnostics: { channel: 2, udsRequestId: '702', timeoutMs: 1000 } });
  expect(loaded.devices[0]).toMatchObject({ label: 'Bridge 3', captureChannels: [1, 2], transmitChannel: 1 });
  expect(storage.getItem(WORKSPACE_KEY)).not.toMatch(/synthetic-secret|bitrate|not-a-panel|not-a-view/);
});

it.each([
  [{ id: 'd1', target: 'ws://localhost:9101' }, { id: 'd1', target: 'ws://localhost:9121' }],
  [{ id: 'd1', target: 'ws://localhost:9101?token=synthetic-secret' }],
  [{ id: 'wrong', target: 'ws://localhost:9101' }],
].map((devices) => ({ devices })))('rejects malformed/unsafe stored device lists without reconnecting', ({ devices }) => {
  const storage = memory();
  storage.setItem(WORKSPACE_KEY, JSON.stringify({ ...emptyWorkspace(), devices }));
  const r = rig(storage);
  expect(r.hub.getState().slots).toHaveLength(0);
  expect(r.transport).not.toHaveBeenCalled();
});

it.each(['ws://localhost:9999', 'ws://localhost:9999/private-path'])('keeps the working remembered endpoint when an edit to %s fails or is canceled', async (attempted) => {
  const r = rig();
  const slot = r.hub.addDevice()!;
  await slot.store.connect('localhost:9101');
  slot.store.setCaptureChannels([1]);
  slot.store.setTransmitChannel(2);
  r.hub.editDevice(slot.id);
  r.transport.mockImplementation((url) => {
    const transport = new FakeTransport(url, r.device);
    transport.failOpen = { phase: 'connecting', code: 1006, reason: '', wasClean: false, initiatedBy: 'remote' };
    return transport;
  });
  await slot.store.connect(attempted);
  expect(slot.store.getState().phase).toBe('closed');
  expect(new WorkspacePersistence(() => r.storage).load().devices).toMatchObject([{ target: 'ws://localhost:9101', captureChannels: [1], transmitChannel: 2 }]);
  r.hub.cancelEdit();
  expect(slot.store.getState()).toMatchObject({ target: 'ws://localhost:9101', phase: 'closed', captureChannels: [1], transmitChannel: 2 });
});

it('canceling during connection restores the committed endpoint and only success commits a replacement', async () => {
  const r = rig();
  const slot = r.hub.addDevice()!;
  await slot.store.connect('localhost:9101');
  r.hub.editDevice(slot.id);
  const factory = r.transport.getMockImplementation()!;
  r.transport.mockImplementation((url) => {
    const transport = new FakeTransport(url, r.device);
    transport.open = () => new Promise<void>(() => undefined);
    return transport;
  });
  void slot.store.connect('localhost:9999');
  expect(slot.store.getState().phase).toBe('connecting');
  expect(new WorkspacePersistence(() => r.storage).load().devices[0].target).toBe('ws://localhost:9101');
  r.hub.cancelEdit();
  expect(slot.store.getState()).toMatchObject({ phase: 'closed', target: 'ws://localhost:9101' });
  r.transport.mockImplementation(factory);
  r.hub.editDevice(slot.id);
  await slot.store.connect('localhost:9121');
  expect(new WorkspacePersistence(() => r.storage).load().devices[0].target).toBe('ws://localhost:9121');
});
