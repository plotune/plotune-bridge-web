// BR-WEB-004 rev 2 acceptance evidence — clauses (a) and (d).
// Observable behaviour of the real persistence + hub + store with the contract-faithful fakes:
// restoring a remembered workspace must bring back only layouts/identifiers/non-energizing preferences,
// never account credentials, and a reconnect must never replay hardware commands or output settings.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceHub } from '../src/state/hub';
import { WORKSPACE_KEY, WorkspacePersistence, emptyWorkspace } from '../src/state/persistence';
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
    statsIntervalMs: 100_000,
  })), (fn) => fn(), new WorkspacePersistence(() => storage));
  hubs.push(hub);
  return { hub, device, transport, permission, storage };
}

/** The only hardware/output commands the workspace may ever send on its own. None may be replayed on restore/reconnect. */
const ENERGIZING = ['set_bitrate', 'set_termination', 'start_rx', 'stop_rx', 'transmit'];

describe('BR-WEB-004 (a) restore layouts, identifiers and non-energizing preferences', () => {
  it('restores the view, device target/label and preferences, disconnected, and starts no connection', async () => {
    const r = rig();
    const slot = r.hub.addDevice()!;
    await slot.store.connect('localhost:9101');
    slot.store.setCaptureChannels([1]);
    slot.store.setTransmitChannel(2);
    r.hub.setPage('diagnostics');
    r.hub.setPanelVisible('capture', 'stats', false);
    r.hub.setDiagSettings({ udsRequestId: '701', xcpPadTo8: true });
    r.hub.explainPermission();

    // Only allowlisted fields are written: no live/hardware state and no credential material.
    const savedRaw = r.storage.data.get(WORKSPACE_KEY)!;
    const saved = JSON.parse(savedRaw);
    expect(Object.keys(saved).sort()).toEqual(['activeId', 'devices', 'diagnostics', 'hidden', 'page', 'permissionExplained', 'traceView', 'version']);
    expect(Object.keys(saved.devices[0]).sort()).toEqual(['captureChannels', 'id', 'label', 'target', 'transmitChannel']);
    expect(savedRaw).not.toMatch(/bitrate|termination|streaming|sessionId|txLog|statistics|password|token|verifier|ticket|secret/i);

    // A fresh page (reload) reads the same storage as a brand-new hub.
    const restored = rig(r.storage);
    expect(restored.transport).not.toHaveBeenCalled();
    expect(restored.permission).not.toHaveBeenCalled();
    const state = restored.hub.getState();
    // layouts
    expect(state.page).toBe('diagnostics');
    expect(state.hidden.capture).toEqual(['stats']);
    expect(state.permissionExplained).toBe(true);
    // non-energizing preferences
    expect(state.diagnostics).toMatchObject({ udsRequestId: '701', xcpPadTo8: true });
    // identifiers
    expect(state.slots).toHaveLength(1);
    expect(state.activeId).toBe(slot.id);
    expect(state.slots[0].label).toBe('Bridge 1');
    expect(restored.hub.active.store.getState()).toMatchObject({
      phase: 'closed', target: 'ws://localhost:9101', descriptor: null, channels: [],
      captureChannels: [1], transmitChannel: 2,
    });
  });

  it('scrubs credential and unknown fields from a saved record, so credentials are never persisted', () => {
    const storage = memory();
    storage.setItem(WORKSPACE_KEY, JSON.stringify({
      ...emptyWorkspace(),
      devices: [{ id: 'd1', target: 'ws://localhost:9101', captureChannels: [1, 2], transmitChannel: 1,
        access_token: 'acct-secret', password: 'pw-secret', ticket: 'tkt-secret', bitrate: 500000 }],
      access_token: 'acct-secret', verifier: 'pkce-secret',
      diagnostics: { udsRequestId: '702', securityKey: 'key-secret' },
    }));
    const r = rig(storage);
    expect(r.storage.data.get(WORKSPACE_KEY)!).not.toMatch(/acct-secret|pw-secret|tkt-secret|pkce-secret|key-secret|bitrate/);
    // The identifier and the safe preference survive; the credential fields do not.
    expect(r.hub.getState().slots).toHaveLength(1);
    expect(r.hub.getState().slots[0].store.getState().target).toBe('ws://localhost:9101');
    expect(r.hub.getState().diagnostics.udsRequestId).toBe('702');
  });

  it.each(['ws://user:password@localhost:9101', 'ws://localhost:9101?token=secret', 'wss://localhost/private-secret', 'ws://localhost/#secret'])(
    'never persists a credential-bearing endpoint: %s', async (target) => {
      const r = rig();
      const slot = r.hub.addDevice()!;
      await slot.store.connect(target);
      expect(r.storage.data.get(WORKSPACE_KEY)!).not.toMatch(/secret|password|token=/i);
      expect(new WorkspacePersistence(() => r.storage).load().devices).toEqual([]);
    });
});

describe('BR-WEB-004 (d) never auto-replay hardware commands or output settings', () => {
  it('a restore + reconnect replays no config/capture/transmit command and no output frame', async () => {
    const storage = memory();
    const r = rig(storage);
    const slot = r.hub.addDevice()!;
    await slot.store.connect('localhost:9101');
    // First session: energizing commands and an output frame are issued by the user.
    await slot.store.setBitrate(1, 500000);
    await slot.store.setTermination(1, true);
    slot.store.setCaptureChannels([1]);
    slot.store.setTransmitChannel(2);
    await slot.store.transmit({ channel: 1, id: 0x123, extended: false, rtr: false, dlc: 1, data: Uint8Array.of(0xab) });
    await slot.store.startCapture();
    expect(r.device.requests.some((m) => ENERGIZING.includes(m.op as string))).toBe(true);
    slot.store.disconnect();

    // A fresh page restores the preferences but must not re-run any of them.
    const restored = rig(storage);
    expect(restored.transport).not.toHaveBeenCalled();
    // Real hardware keeps its configuration and may already be capturing; the app must read, never command.
    restored.device.channels[0].bitrate = 500000;
    restored.device.channels[0].termination = true;
    restored.device.channels[0].streaming = true;
    await restored.hub.active.store.connect('localhost:9101');

    const state = restored.hub.active.store.getState();
    expect(state.phase).toBe('connected');
    // Preferences are restored as local UI state, not replayed as commands.
    expect(state.captureChannels).toEqual([1]);
    expect(state.transmitChannel).toBe(2);
    expect(state.txLog).toEqual([]); // no output frame replayed
    expect(state.capturing).toBe(true); // read from the device, not commanded by the app
    expect(state.channels[0]).toMatchObject({ bitrate: 500000, termination: true, streaming: true });
    const ops = restored.device.requests.map((m) => m.op as string);
    expect(ops.filter((op) => ENERGIZING.includes(op))).toEqual([]);
    expect(ops).toContain('hello'); // the only setup is the protocol hello + read-only polling
  });
});
