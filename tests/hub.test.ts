import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceHub, MAX_DEVICES } from '../src/state/hub';
import { WorkspaceStore, type WorkspaceEnv } from '../src/state/store';
import type { TransportFactory } from '../src/transport/types';
import { FakeTransport } from './helpers/fakes';
import { MockDeviceCore } from './helpers/mockDevice';

function makeHub() {
  const devices = new Map<string, MockDeviceCore>();
  const hub = new DeviceHub(() => {
    const transportFactory: TransportFactory = (target) => {
      if (!devices.has(target)) devices.set(target, new MockDeviceCore({ deviceId: `dev-${target}` }));
      return new FakeTransport(target, devices.get(target)!);
    };
    const env: WorkspaceEnv = {
      transportFactory,
      browser: { family: 'chromium', name: 'Chrome', supported: true },
      pageIsSecure: true,
      pageOrigin: 'https://bridge.plotune.net',
      queryPermission: async () => 'granted',
      schedule: (fn) => fn(),
      statsIntervalMs: 1000,
      slowConnectMs: 1500,
    };
    return new WorkspaceStore(env);
  }, (fn) => fn());
  return { hub, devices };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('several devices', () => {
  it('starts with one empty device and adds more up to the limit', () => {
    const { hub } = makeHub();
    expect(hub.getState().slots.map((s) => s.label)).toEqual(['Bridge 1']);
    for (let i = 1; i < MAX_DEVICES; i += 1) expect(hub.addDevice()).not.toBeNull();
    expect(hub.addDevice()).toBeNull();
    expect(hub.getState().slots).toHaveLength(MAX_DEVICES);
  });

  it('keeps each device connection, channels and counters separate', async () => {
    const { hub } = makeHub();
    const a = hub.active;
    await a.store.connect('10.0.0.1:9101');
    const b = hub.addDevice()!;
    expect(hub.active.id).toBe(b.id);
    await b.store.connect('10.0.0.2:9101');
    await a.store.setBitrate(1, 250000);
    expect(a.store.getState().channels[0].bitrate).toBe(250000);
    expect(b.store.getState().channels[0].bitrate).toBeNull();
    expect(a.store.getState().descriptor?.deviceId).not.toBe(b.store.getState().descriptor?.deviceId);
  });

  it('merges traces in arrival order, tagging each row with its device and own time origin', async () => {
    const { hub, devices } = makeHub();
    await hub.active.store.connect('10.0.0.1:9101');
    const second = hub.addDevice()!;
    await second.store.connect('10.0.0.2:9101');
    for (const s of hub.getState().slots) {
      await s.store.setBitrate(1, 500000);
      await s.store.setBitrate(2, 500000);
    }
    await hub.startAll();
    const d1 = devices.get('ws://10.0.0.1:9101')!;
    const d2 = devices.get('ws://10.0.0.2:9101')!;
    d1.injectRx(1, { id: 0x100, data: Uint8Array.of(1) });
    d1.deliver();
    d2.injectRx(1, { id: 0x200, data: Uint8Array.of(2) });
    d2.deliver();
    await vi.advanceTimersByTimeAsync(10);
    const labels: string[] = [];
    for (let i = 0; i < hub.merged.length; i += 1) {
      const row = hub.merged.at(i);
      if (row.kind === 'frame') labels.push(`${row.device}:${row.frame.id.toString(16)}`);
    }
    expect(labels).toEqual(['Bridge 1:100', 'Bridge 2:200']);
    expect(hub.traceBuffer()).toBe(hub.merged);
    hub.setTraceView(second.id);
    expect(hub.traceBuffer()).toBe(second.store.trace);
  });

  it('removing a device disconnects it; the last device is only reset', async () => {
    const { hub } = makeHub();
    const first = hub.active;
    await first.store.connect('10.0.0.1:9101');
    const second = hub.addDevice()!;
    await second.store.connect('10.0.0.2:9101');
    hub.removeDevice(second.id);
    expect(hub.getState().slots.map((s) => s.id)).toEqual([first.id]);
    expect(hub.active.id).toBe(first.id);
    expect(second.store.getState().phase).not.toBe('connected');
    hub.removeDevice(first.id);
    expect(hub.getState().slots).toHaveLength(1);
    expect(first.store.getState().phase).toBe('idle');
  });

  it('a single device uses its own trace, so nothing changes for one-device use', async () => {
    const { hub } = makeHub();
    expect(hub.traceBuffer()).toBe(hub.active.store.trace);
  });
});
