// A paired device that does not answer: the staged connecting screen, the plain failure notices with Try again, and
// Cancel that stops the attempt and returns to the device list. The transport is a controllable fake: the test decides
// each stage, each answer and each late result. Timers are the fake clock's, so every bound is deterministic.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { createCloudSession } from '../src/cloud/session';
import { ConnectStatus, SLOW_STAGE_MS } from '../src/components/ConnectStatus';
import { DeviceHub } from '../src/state/hub';
import { WORKSPACE_KEY, WorkspacePersistence, type SavedDevice } from '../src/state/persistence';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { TransportOpenError, type CloseInfo, type ConnectStage, type DeviceTransport } from '../src/transport/types';
import { fakeSso } from './helpers/sso';

const BROWSER = { family: 'chromium', name: 'Chrome', supported: true } as const;
const REMOTE = 'remote:proj_1/dev-1';
const REMEMBERED: SavedDevice = { id: 'd1', label: 'Bridge 1', target: REMOTE, captureChannels: [1, 2], transmitChannel: 1 };

interface Attempt {
  target: string;
  closed: boolean;
  stage: (stage: ConnectStage | null) => void;
  succeed: () => void;
  fail: (reason: string) => void;
}

/** One entry per connection attempt the store starts. `closeRejects` controls whether close() ends the open, as the real adapter does. */
function fakeFactory(attempts: Attempt[], options: { closeRejects?: boolean } = {}) {
  return (target: string): DeviceTransport => {
    let stageListener: ((stage: ConnectStage | null) => void) | null = null;
    let settleOpen: { resolve: () => void; reject: (error: unknown) => void } | null = null;
    const attempt: Attempt = {
      target,
      closed: false,
      stage: (stage) => stageListener?.(stage),
      succeed: () => settleOpen?.resolve(),
      fail: (reason) => settleOpen?.reject(new TransportOpenError({ phase: 'connecting', code: null, reason, wasClean: false, initiatedBy: 'local' }, reason)),
    };
    attempts.push(attempt);
    return {
      kind: 'fake',
      target,
      open: () => new Promise<void>((resolve, reject) => {
        settleOpen = { resolve, reject };
      }),
      send: () => undefined,
      close: () => {
        attempt.closed = true;
        if (options.closeRejects !== false) {
          const info: CloseInfo = { phase: 'connecting', code: null, reason: 'closed by this page', wasClean: true, initiatedBy: 'local' };
          settleOpen?.reject(new TransportOpenError(info, 'closed before the link opened'));
        }
      },
      setListener: () => undefined,
      onStage: (listener) => {
        stageListener = listener;
      },
    };
  };
}

function seed(devices: SavedDevice[]): void {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
    version: 1, devices, activeId: devices[0]?.id ?? '', traceView: 'all', page: 'capture',
    hidden: { capture: [], diagnostics: [], device: [] }, diagnostics: {}, permissionExplained: true,
  }));
}

function load(factory: (target: string) => DeviceTransport, devices: SavedDevice[] = [REMEMBERED]) {
  seed(devices);
  const hub = new DeviceHub(
    () => new WorkspaceStore(defaultEnv({ transportFactory: factory, browser: BROWSER, pageIsSecure: true, queryPermission: async () => 'unknown', schedule: (fn) => fn(), slowConnectMs: 1e9 })),
    (fn) => fn(),
    new WorkspacePersistence(),
  );
  render(
    <App hub={hub} browser={BROWSER} pageOrigin="https://bridge.plotune.net" cloudClient={{} as never} cloudSession={createCloudSession()} cloudSso={fakeSso()} />,
  );
  return hub;
}

/** Starts a connection on the device's own slot, as the Connect action does. */
async function connect(hub: DeviceHub, id = 'd1'): Promise<void> {
  await act(async () => {
    void hub.slot(id)!.store.connect(REMOTE);
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('the staged connecting screen', () => {
  it('shows the stages in order, with the device stage explained, and always a Cancel button', async () => {
    const attempts: Attempt[] = [];
    const hub = load(fakeFactory(attempts));
    await connect(hub);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Contacting the Plotune cloud…');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();

    await act(async () => attempts[0].stage('device'));
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your device…');
    expect(screen.getByText('Make sure it is powered on and connected to Wi-Fi.')).toBeVisible();

    await act(async () => attempts[0].stage('link'));
    expect(screen.getByRole('status')).toHaveTextContent('Setting up the connection…');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  it('after 5 seconds in the device stage it adds "This is taking longer than usual.", and only for that stage', () => {
    vi.useFakeTimers();
    const { rerender } = render(<ConnectStatus stage="device" />);
    expect(screen.queryByText('This is taking longer than usual.')).toBeNull();
    act(() => vi.advanceTimersByTime(SLOW_STAGE_MS - 1));
    expect(screen.queryByText('This is taking longer than usual.')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('This is taking longer than usual.')).toBeVisible();
    rerender(<ConnectStatus stage="link" />);
    expect(screen.queryByText('This is taking longer than usual.')).toBeNull();
    rerender(<ConnectStatus stage="device" />);
    expect(screen.queryByText('This is taking longer than usual.')).toBeNull();
    act(() => vi.advanceTimersByTime(SLOW_STAGE_MS));
    expect(screen.getByText('This is taking longer than usual.')).toBeVisible();
    vi.useRealTimers();
  });
});

describe('the failure notices', () => {
  it.each([
    ['device is not online', 'Your device is not reachable', 'The Plotune cloud is working, but your device did not answer.'],
    ['cloud unreachable', "Couldn't reach the Plotune cloud", 'The Plotune cloud did not answer in time.'],
    ['link setup timed out', 'The connection could not be set up', 'could not be set up in time.'],
  ])('a %s failure shows its own notice, Try again first and Choose a device second', async (reason, title, summary) => {
    const attempts: Attempt[] = [];
    const hub = load(fakeFactory(attempts));
    await connect(hub);
    await act(async () => attempts[0].fail(reason));

    const notice = (await screen.findByText(title)).closest('.bw-notice') as HTMLElement;
    expect(notice).toHaveTextContent(summary);
    expect(screen.queryByText('The browser and the cloud do not say which step failed.')).toBeNull();
    const buttons = screen.getAllByRole('button').filter((b) => ['Try again', 'Choose a device'].includes(b.textContent ?? ''));
    expect(buttons.map((b) => b.textContent)).toEqual(['Try again', 'Choose a device']);
    // The stage and reason stay in the technical details.
    expect(screen.getByText(new RegExp(`reason: ${reason}`))).toBeInTheDocument();
  });

  it('Try again starts a new attempt for the same device', async () => {
    const attempts: Attempt[] = [];
    const hub = load(fakeFactory(attempts));
    await connect(hub);
    await act(async () => attempts[0].fail('device is not online'));
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(attempts).toHaveLength(2);
    expect(attempts[1].target).toBe(REMOTE);
  });
});

describe('Cancel', () => {
  it('stops the attempt, returns to the device list, and does not mark the device not reachable', async () => {
    const attempts: Attempt[] = [];
    const hub = load(fakeFactory(attempts));
    await connect(hub);
    await act(async () => attempts[0].stage('device'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(attempts[0].closed).toBe(true);
    expect(hub.slot('d1')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Sign in to connect your Bridge' })).toBeVisible();
    expect(screen.queryByText('Your workspace')).toBeNull();
    expect(hub.lastFailureAt(REMOTE)).toBeNull();
    expect(screen.queryByText('Your device is not reachable')).toBeNull();
  });

  it('a late failure of a cancelled attempt is ignored: no notice and no mark', async () => {
    const attempts: Attempt[] = [];
    const hub = load(fakeFactory(attempts, { closeRejects: false }));
    await connect(hub);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => attempts[0].fail('device is not online'));
    expect(hub.slot('d1')!.store.getState().notice?.kind).toBe('ended');
    expect(screen.queryByText('Your device is not reachable')).toBeNull();
    expect(hub.lastFailureAt(REMOTE)).toBeNull();
  });

  it('a late success of a cancelled attempt does not connect the device', async () => {
    const attempts: Attempt[] = [];
    const hub = load(fakeFactory(attempts, { closeRejects: false }));
    await connect(hub);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => attempts[0].succeed());
    await act(async () => undefined);
    expect(hub.slot('d1')!.store.getState().phase).not.toBe('connected');
    expect(attempts[0].closed).toBe(true);
  });

  it('for an unremembered device, the add-device pane stays open instead of dropping to the empty workspace', async () => {
    const attempts: Attempt[] = [];
    const hub = load(fakeFactory(attempts), []);
    act(() => {
      hub.addDevice();
    });
    await connect(hub, hub.getState().activeId);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Your workspace')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Sign in to connect your Bridge' })).toBeVisible();
    expect(hub.getState().slots).toHaveLength(1);
    expect(attempts[0].closed).toBe(true);
  });

  it('a remembered device keeps its slot after Cancel', async () => {
    const attempts: Attempt[] = [];
    const hub = load(fakeFactory(attempts));
    await connect(hub);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(hub.getState().slots.map((s) => s.id)).toEqual(['d1']);
    expect(screen.getAllByText('Bridge 1').length).toBeGreaterThan(0);
  });
});
