// BR-WEB-006 rev 2: a connection the browser refuses (unsupported browser, or a plain ws:// address on a
// secure HTTPS page) cannot succeed by retrying. The connect screen must offer "Change address" only.
// L2 component level: ConnectView rendered with each notice, using a stable fake store/hub snapshot.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectView } from '../src/components/ConnectView';
import { HubProvider, StoreProvider } from '../src/state/context';
import type { DeviceHub, HubState } from '../src/state/hub';
import type { WorkspaceState, WorkspaceStore } from '../src/state/store';
import { explainOpenFailure, type Notice, type NoticeContext } from '../src/transport/notices';
import type { BrowserInfo } from '../src/lib/browser';

const BROWSER: BrowserInfo = { family: 'chromium', name: 'Chrome', supported: true };
const CTX: NoticeContext = { pageOrigin: 'https://bridge.plotune.net', targetUrl: 'ws://192.0.2.1:9', permission: 'unknown' };

const mixedContent = explainOpenFailure(
  { phase: 'connecting', code: null, reason: 'SecurityError', wasClean: false, initiatedBy: 'local' }, CTX,
);
const unreachable = explainOpenFailure(
  { phase: 'connecting', code: 1006, reason: '', wasClean: false, initiatedBy: 'remote' }, CTX,
);
const blockedByBrowser: Notice = {
  kind: 'blocked-by-browser', severity: 'error', title: 'This address cannot be opened from this browser',
  summary: 'Firefox blocks plain ws:// connections from secure pages.', steps: [], technical: '',
};

function renderConnectView(notice: Notice) {
  const snapshot: WorkspaceState = {
    phase: 'closed', target: 'ws://192.0.2.1:9', notice, slowConnect: false, connectStage: null,
    permission: 'unknown', descriptor: null, connectionPath: null, traffic: null, channels: [],
    statistics: [], capturing: false, captureChannels: [1, 2], transmitChannel: 1, busy: false,
    sessionNumber: 0, lostBatches: 0, droppedReported: {}, actionError: null, txLog: [], traceVersion: 0,
  };
  const hubState = { permissionExplained: true } as HubState;
  const store = {
    subscribe: () => () => {}, getState: () => snapshot, connect: vi.fn(), reset: vi.fn(),
  } as unknown as WorkspaceStore;
  const hub = {
    active: { id: 'd1' }, subscribe: () => () => {}, getState: () => hubState,
    explainPermission: vi.fn(), cancelEdit: vi.fn(), cancelConnect: vi.fn(),
  } as unknown as DeviceHub;
  return render(
    <HubProvider hub={hub}>
      <StoreProvider store={store}>
        <ConnectView browser={BROWSER} pageOrigin="https://bridge.plotune.net" />
      </StoreProvider>
    </HubProvider>,
  );
}

afterEach(cleanup);

describe('BR-WEB-006 r2: no pointless retry for a browser-refused combination', () => {
  it('a SecurityError / mixed-content notice offers Change address only', () => {
    renderConnectView(mixedContent);
    expect(screen.getByText('This secure page cannot open a plain ws:// address')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Change address' })).toBeVisible();
  });

  it('an unsupported-browser / blocked-by-browser notice offers Change address only', () => {
    renderConnectView(blockedByBrowser);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Change address' })).toBeVisible();
  });

  it('a normal unreachable notice still offers Try again (control)', () => {
    renderConnectView(unreachable);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Change address' })).toBeVisible();
  });
});
