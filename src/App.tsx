import { useState } from 'react';
import type { BrowserInfo } from './lib/browser';
import { ConnectView, UnsupportedBanner } from './components/ConnectView';
import { IconDevice, IconDiagnose, IconStart, IconStop, IconTrace } from './components/icons';
import { NoticeCard } from './components/Notice';
import { Dashboard, capturePanels, devicePanels, diagnosticsPanels, useDiagnostics, type PageId } from './components/pages';
import { SetupPane } from './components/SetupPane';
import { HubProvider, StoreProvider, useHub, useHubState, useStore, useWorkspace } from './state/context';
import type { DeviceHub } from './state/hub';
import logo from './assets/plotune-logo.png';

const NAV: { id: PageId; label: string; icon: typeof IconTrace }[] = [
  { id: 'capture', label: 'Capture', icon: IconTrace },
  { id: 'diagnostics', label: 'Diagnostics', icon: IconDiagnose },
  { id: 'device', label: 'Device', icon: IconDevice },
];

/** Start and stop for every connected device at once, as one measurement. */
function MeasurementControls() {
  const hub = useHub();
  const { slots } = useHubState();
  const states = slots.map((s) => s.store.getState());
  const connected = states.filter((s) => s.phase === 'connected');
  const capturing = connected.some((s) => s.capturing);
  const busy = states.some((s) => s.busy);
  return capturing ? (
    <button type="button" className="bw-button bw-small" onClick={() => void hub.stopAll()} disabled={busy}>
      <IconStop /> Stop capture
    </button>
  ) : (
    <button type="button" className="bw-button bw-primary bw-small" onClick={() => void hub.startAll()} disabled={connected.length === 0 || busy}>
      <IconStart /> Start capture
    </button>
  );
}

function Topbar({ showControls }: { showControls: boolean }) {
  const { slots } = useHubState();
  const connected = slots.filter((s) => s.store.getState().phase === 'connected').length;
  return (
    <header className="bw-topbar">
      <a className="bw-brand" href="https://plotune.net">
        <img className="bw-brand-logo" src={logo} alt="" />
        <strong>
          Plotune <span>Bridge</span>
        </strong>
      </a>
      {showControls && (
        <>
          <span className="bw-top-divider" />
          <MeasurementControls />
          <span className="bw-muted bw-top-summary">
            {connected} of {slots.length} {slots.length === 1 ? 'device' : 'devices'} connected
          </span>
        </>
      )}
    </header>
  );
}

function ConnectionBanner() {
  const store = useStore();
  const state = useWorkspace();
  if (state.phase === 'connecting') {
    return (
      <div className="bw-banner" role="status" data-testid="reconnecting">
        <span className="bw-spinner" aria-hidden="true" /> Reconnecting to {state.target}…{state.slowConnect ? ' If your browser asks about local network access, choose Allow.' : ''}
      </div>
    );
  }
  if (state.phase === 'closed' && state.notice) {
    return (
      <NoticeCard
        notice={state.notice}
        actions={
          <>
            <button type="button" className="bw-button bw-primary" onClick={() => void store.connect(state.target)}>
              Reconnect
            </button>
            <button type="button" className="bw-button" onClick={() => store.reset()}>
              Change address
            </button>
          </>
        }
      />
    );
  }
  return null;
}

function WindowBar({ page, onPage, menu }: { page: PageId; onPage: (page: PageId) => void; menu?: React.ReactNode }) {
  const state = useWorkspace();
  const { slots } = useHubState();
  const hub = useHub();
  return (
    <div className="bw-windowbar">
      <nav className="bw-tabs" aria-label="Workspace">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => onPage(id)}>
            <Icon /> {label}
          </button>
        ))}
      </nav>
      {slots.length > 1 && <span className="bw-device-tag" data-testid="active-device">{hub.active.label}{state.descriptor ? ` · ${state.descriptor.deviceId}` : ''}</span>}
      <div className="bw-windowbar-end">{menu}</div>
    </div>
  );
}

function AddDevicePane({ browser, pageOrigin }: { browser: BrowserInfo; pageOrigin: string }) {
  const hub = useHub();
  const { activeId } = useHubState();
  return (
    <div className="bw-add-device">
      <ConnectView browser={browser} pageOrigin={pageOrigin} />
      <div className="bw-actions">
        <button type="button" className="bw-button" onClick={() => hub.removeDevice(activeId)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function WorkspaceBody({ page, onPage, browser, pageOrigin }: { page: PageId; onPage: (page: PageId) => void; browser: BrowserInfo; pageOrigin: string }) {
  const diag = useDiagnostics();
  const diagPanels = diagnosticsPanels(diag);
  const state = useWorkspace();
  const { slots } = useHubState();
  const neverConnected = state.sessionNumber === 0 && slots.length > 1;
  const bar = (menu?: React.ReactNode) => <WindowBar page={page} onPage={onPage} menu={menu} />;
  return (
    <main className="bw-main" data-page={page}>
      {neverConnected ? (
        <AddDevicePane browser={browser} pageOrigin={pageOrigin} />
      ) : (
        <>
          <ConnectionBanner />
          {page === 'capture' && <Dashboard page="capture" panels={capturePanels} head={bar} />}
          {page === 'diagnostics' && <Dashboard page="diagnostics" panels={diagPanels} head={bar} />}
          {page === 'device' && <Dashboard page="device" panels={devicePanels} head={bar} />}
        </>
      )}
    </main>
  );
}

function ActiveStore({ children }: { children: React.ReactNode }) {
  const { slots, activeId } = useHubState();
  const slot = slots.find((s) => s.id === activeId) ?? slots[0];
  return <StoreProvider store={slot.store}>{children}</StoreProvider>;
}

function Workspace({ browser, pageOrigin }: { browser: BrowserInfo; pageOrigin: string }) {
  const { activeId } = useHubState();
  const [page, setPage] = useState<PageId>('capture');
  return (
    <ActiveStore>
      <div className="bw-shell">
        <SetupPane />
        <WorkspaceBody key={activeId} page={page} onPage={setPage} browser={browser} pageOrigin={pageOrigin} />
      </div>
    </ActiveStore>
  );
}

function Shell({ browser, pageOrigin }: { browser: BrowserInfo; pageOrigin: string }) {
  const { slots } = useHubState();
  const showWorkspace = slots.some((s) => {
    const state = s.store.getState();
    return state.sessionNumber > 0 && state.phase !== 'idle';
  });
  return (
    <>
      <Topbar showControls={showWorkspace} />
      {showWorkspace ? (
        <>
          {!browser.supported && (
            <div className="bw-unsupported-strip">
              <UnsupportedBanner browser={browser} />
            </div>
          )}
          <Workspace browser={browser} pageOrigin={pageOrigin} />
        </>
      ) : (
        <ActiveStore>
          <main className="bw-center">
            <ConnectView browser={browser} pageOrigin={pageOrigin} />
          </main>
        </ActiveStore>
      )}
    </>
  );
}

export function App({ hub, browser, pageOrigin = location.origin }: { hub: DeviceHub; browser: BrowserInfo; pageOrigin?: string }) {
  return (
    <HubProvider hub={hub}>
      <div className="bw-app">
        <Shell browser={browser} pageOrigin={pageOrigin} />
      </div>
    </HubProvider>
  );
}
