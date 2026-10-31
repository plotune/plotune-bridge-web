import { useState } from 'react';
import type { BrowserInfo } from './lib/browser';
import { CloudProvider, useCloud } from './cloud/context';
import type { CloudClient } from './cloud/client';
import type { CloudSession } from './cloud/session';
import type { SsoBrowser } from './cloud/sso';
import { AccountDevices } from './components/AccountDevices';
import { AccountMenu } from './components/AccountMenu';
import { ConnectView } from './components/ConnectView';
import { IconDevice, IconDiagnose, IconStart, IconStop, IconTrace } from './components/icons';
import { NoticeCard } from './components/Notice';
import { Dashboard, capturePanels, devicePanels, diagnosticsPanels, useDiagnostics, type PageId } from './components/pages';
import { SetupPane } from './components/SetupPane';
import { HubProvider, StoreProvider, useHub, useHubState, useStore, useWorkspace } from './state/context';
import type { DeviceHub } from './state/hub';
import { isRemoteTarget } from './transport/remote';
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
      <div className="bw-top-end">
        <AccountMenu />
      </div>
    </header>
  );
}

function ConnectionBanner() {
  const store = useStore();
  const hub = useHub();
  const state = useWorkspace();
  const remote = isRemoteTarget(state.target);
  if (state.phase === 'connecting') {
    return (
      <div className="bw-banner" role="status" data-testid="reconnecting">
        <span className="bw-spinner" aria-hidden="true" />{' '}
        {remote ? 'Reconnecting through the Plotune cloud…' : <>Reconnecting to {state.target}…{state.slowConnect ? ' If your browser asks about local network access, choose Allow.' : ''}</>}
      </div>
    );
  }
  if (state.phase === 'closed' && state.notice) {
    if (remote) {
      // A remote device reconnects with the account session; without one the only useful step is signing in.
      const signedOut = state.notice.kind === 'signed-out';
      return (
        <NoticeCard
          notice={state.notice}
          actions={
            <>
              {signedOut ? (
                <button type="button" className="bw-button bw-primary" onClick={() => hub.editDevice(hub.active.id)}>
                  Sign in
                </button>
              ) : (
                <button type="button" className="bw-button bw-primary" onClick={() => void store.connect(state.target)}>
                  Reconnect
                </button>
              )}
              <button type="button" className="bw-button" onClick={() => hub.editDevice(hub.active.id)}>
                Choose a device
              </button>
            </>
          }
        />
      );
    }
    return (
      <NoticeCard
        notice={state.notice}
        actions={
          <>
            <button type="button" className="bw-button bw-primary" onClick={() => void store.connect(state.target)}>
              Reconnect
            </button>
            <button type="button" className="bw-button" onClick={() => hub.editDevice(hub.active.id)}>
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

/** The add-device pane. The Plotune account is the default; the local-network address form stays behind "Advanced". */
function AddDevicePane({ browser, pageOrigin }: { browser: BrowserInfo; pageOrigin: string }) {
  const hub = useHub();
  const store = useStore();
  const state = useWorkspace();
  const [mode, setMode] = useState<'account' | 'local'>('account');
  const connecting = state.phase === 'connecting';
  const cancel = (
    <div className="bw-actions">
      <button type="button" className="bw-button" onClick={() => hub.cancelEdit()}>
        Cancel
      </button>
    </div>
  );

  if (mode === 'account' && !connecting) {
    // A failed remote connection is explained above the device list; a local-network failure is shown in the local form.
    const remoteNotice = state.notice && isRemoteTarget(state.target) ? state.notice : null;
    const retry = remoteNotice !== null && remoteNotice.kind !== 'signed-out' && remoteNotice.kind !== 'ended';
    return (
      <div className="bw-add-device">
        {remoteNotice && (
          <NoticeCard
            notice={remoteNotice}
            actions={
              <>
                {retry && (
                  <button type="button" className="bw-button bw-primary" onClick={() => void store.connect(state.target)}>
                    Try again
                  </button>
                )}
                <button type="button" className="bw-button" onClick={() => store.reset()}>
                  Dismiss
                </button>
              </>
            }
          />
        )}
        <AccountDevices onAdvanced={() => setMode('local')} />
        {cancel}
      </div>
    );
  }

  return (
    <div className="bw-add-device">
      <ConnectView browser={browser} pageOrigin={pageOrigin} />
      {!connecting && (
        <>
          <button type="button" className="bw-link-button" onClick={() => setMode('account')}>
            Use my Plotune account
          </button>
          {cancel}
        </>
      )}
    </div>
  );
}

/** While a sign-in redirect or exchange runs, and the notice when one failed. Shown above the page on any page. */
function SignInBanner() {
  const cloud = useCloud();
  if (cloud.status === 'signing-in') {
    return (
      <div className="bw-banner" role="status">
        <span className="bw-spinner" aria-hidden="true" /> Signing you in…
      </div>
    );
  }
  if (cloud.signInNotice !== null) {
    return (
      <div className="bw-notice bw-notice-error" role="alert">
        <div className="bw-notice-body">
          <p>{cloud.signInNotice}</p>
          <div className="bw-notice-actions">
            <button type="button" className="bw-button" onClick={() => cloud.dismissSignInNotice()}>
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

/** First visit: say what to do and give one obvious way to start. The sidebar "+" is easy to miss. */
function EmptyIntro() {
  const hub = useHub();
  return (
    <div className="bw-offline-intro" data-testid="empty-intro">
      <h1>Your workspace</h1>
      <p>Sign in with your Plotune account to pair a Bridge device and connect to it from anywhere. You can also explore the panels offline, or connect on your local network.</p>
      <div className="bw-actions">
        <button type="button" className="bw-button bw-primary" onClick={() => hub.addDevice()}>
          Sign in and add a device
        </button>
      </div>
    </div>
  );
}

function WorkspaceBody({ page, onPage, browser, pageOrigin }: { page: PageId; onPage: (page: PageId) => void; browser: BrowserInfo; pageOrigin: string }) {
  const diag = useDiagnostics();
  const diagPanels = diagnosticsPanels(diag);
  const { slots, editingId, activeId } = useHubState();
  const editing = editingId !== null && editingId === activeId;
  const bar = (menu?: React.ReactNode) => <WindowBar page={page} onPage={onPage} menu={menu} />;
  return (
    <main className="bw-main" data-page={page}>
      <SignInBanner />
      {editing ? (
        <>{bar()}<AddDevicePane browser={browser} pageOrigin={pageOrigin} /></>
      ) : (
        <>
          {slots.length === 0 && <EmptyIntro />}
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
  const hub = useHub();
  useHubState();
  const slot = hub.active;
  return <StoreProvider store={slot.store}>{children}</StoreProvider>;
}

function Workspace({ browser, pageOrigin }: { browser: BrowserInfo; pageOrigin: string }) {
  const { activeId, page } = useHubState();
  const hub = useHub();
  return (
    <ActiveStore>
      <div className="bw-shell">
        <SetupPane />
        <WorkspaceBody key={activeId} page={page} onPage={(next) => hub.setPage(next)} browser={browser} pageOrigin={pageOrigin} />
      </div>
    </ActiveStore>
  );
}

function Shell({ browser, pageOrigin }: { browser: BrowserInfo; pageOrigin: string }) {
  return (
    <>
      <Topbar showControls />
      <Workspace browser={browser} pageOrigin={pageOrigin} />
    </>
  );
}

export interface AppProps {
  hub: DeviceHub;
  browser: BrowserInfo;
  pageOrigin?: string;
  /** Tests inject a fake cloud client, their own session and a fake browser sign-in hook. The app uses the defaults. */
  cloudClient?: CloudClient;
  cloudSession?: CloudSession;
  cloudSso?: SsoBrowser;
}

export function App({ hub, browser, pageOrigin = location.origin, cloudClient, cloudSession, cloudSso }: AppProps) {
  return (
    <CloudProvider client={cloudClient} session={cloudSession} sso={cloudSso}>
      <HubProvider hub={hub}>
        <div className="bw-app">
          <Shell browser={browser} pageOrigin={pageOrigin} />
        </div>
      </HubProvider>
    </CloudProvider>
  );
}
