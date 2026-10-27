import { useState } from 'react';
import type { BrowserInfo } from './lib/browser';
import { ConnectView, UnsupportedBanner } from './components/ConnectView';
import { IconDevice, IconDiagnose, IconStart, IconStop, IconTrace } from './components/icons';
import { NoticeCard } from './components/Notice';
import { Dashboard, capturePanels, devicePanels, diagnosticsPanels, useDiagnostics, type PageId } from './components/pages';
import { StoreProvider, useStore, useWorkspace } from './state/context';
import type { WorkspaceStore } from './state/store';
import logo from './assets/plotune-logo.png';

const NAV: { id: PageId; label: string; icon: typeof IconTrace }[] = [
  { id: 'capture', label: 'Capture', icon: IconTrace },
  { id: 'diagnostics', label: 'Diagnostics', icon: IconDiagnose },
  { id: 'device', label: 'Device', icon: IconDevice },
];

function Topbar() {
  const store = useStore();
  const state = useWorkspace();
  const had = state.sessionNumber > 0;
  return (
    <header className="bw-topbar">
      <a className="bw-brand" href="https://plotune.net">
        <img className="bw-brand-logo" src={logo} alt="" />
        <strong>
          Plotune <span>Bridge</span>
        </strong>
      </a>
      <span className="bw-top-divider" />
      {had && (
        <div className="bw-device-chip" data-testid="device-chip" data-phase={state.phase}>
          <span className={`bw-led bw-led-${state.phase}`} aria-hidden="true" />
          <span className="bw-mono">{state.descriptor?.deviceId ?? state.target}</span>
          <span className="bw-muted">{state.phase === 'connected' ? 'Connected' : state.phase === 'connecting' ? 'Connecting…' : 'Disconnected'}</span>
        </div>
      )}
      <div className="bw-top-end">
        {state.phase === 'connected' && (
          <button type="button" className="bw-button bw-small" onClick={() => store.disconnect()}>
            Disconnect
          </button>
        )}
      </div>
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

function PageHead({ title, lead, menu, children }: { title: string; lead: string; menu?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="bw-page-head">
      <div>
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
      <div className="bw-page-actions">
        {menu}
        {children}
      </div>
    </div>
  );
}

function CaptureControls() {
  const store = useStore();
  const state = useWorkspace();
  const connected = state.phase === 'connected';
  return state.capturing ? (
    <button type="button" className="bw-button" onClick={() => void store.stopCapture()} disabled={!connected || state.busy}>
      <IconStop /> Stop capture
    </button>
  ) : (
    <button type="button" className="bw-button bw-primary" onClick={() => void store.startCapture()} disabled={!connected || state.busy}>
      <IconStart /> Start capture
    </button>
  );
}

function Workspace() {
  const [page, setPage] = useState<PageId>('capture');
  const diag = useDiagnostics();
  const diagPanels = diagnosticsPanels(diag);
  return (
    <div className="bw-shell">
      <nav className="bw-sidebar" aria-label="Workspace">
        <p className="bw-nav-label">Workspace</p>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
            <Icon /> {label}
          </button>
        ))}
      </nav>
      <main className="bw-main">
        <ConnectionBanner />
        {page === 'capture' && (
          <Dashboard page="capture" panels={capturePanels} head={(menu) => <PageHead title="Capture" lead="Watch both channels, send frames and see what the device could not deliver." menu={menu}><CaptureControls /></PageHead>} />
        )}
        {page === 'diagnostics' && (
          <Dashboard page="diagnostics" panels={diagPanels} head={(menu) => <PageHead title="Diagnostics" lead="Send diagnostic requests and read or write memory, from this page, over the same capture." menu={menu} />} />
        )}
        {page === 'device' && <Dashboard page="device" panels={devicePanels} head={() => <PageHead title="Device" lead="The connected device and how this page is connected to it." />} />}
      </main>
    </div>
  );
}

function Shell({ browser, pageOrigin }: { browser: BrowserInfo; pageOrigin: string }) {
  const state = useWorkspace();
  const showWorkspace = state.sessionNumber > 0 && state.phase !== 'idle';
  return (
    <>
      <Topbar />
      {showWorkspace ? (
        <>
          {!browser.supported && (
            <div className="bw-unsupported-strip">
              <UnsupportedBanner browser={browser} />
            </div>
          )}
          <Workspace />
        </>
      ) : (
        <main className="bw-center">
          <ConnectView browser={browser} pageOrigin={pageOrigin} />
        </main>
      )}
    </>
  );
}

export function App({ store, browser, pageOrigin = location.origin }: { store: WorkspaceStore; browser: BrowserInfo; pageOrigin?: string }) {
  return (
    <StoreProvider store={store}>
      <div className="bw-app">
        <Shell browser={browser} pageOrigin={pageOrigin} />
      </div>
    </StoreProvider>
  );
}
