import { useEffect, useState } from 'react';
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
import { SignInCard } from './components/SignInCard';
import { SignInPending } from './components/SignInPending';
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

function ConnectionBanner({ onLocal }: { onLocal: () => void }) {
  const store = useStore();
  const hub = useHub();
  const cloud = useCloud();
  const state = useWorkspace();
  const { queueSettledFor } = useHubState();
  const remote = isRemoteTarget(state.target);
  if (state.phase === 'connecting') {
    return (
      <div className="bw-banner" role="status" data-testid="reconnecting">
        <span className="bw-spinner" aria-hidden="true" />{' '}
        {remote ? 'Connecting through the Plotune cloud…' : <>Reconnecting to {state.target}…{state.slowConnect ? ' If your browser asks about local network access, choose Allow.' : ''}</>}
      </div>
    );
  }
  if (state.phase === 'closed' && state.notice) {
    if (remote && state.notice.kind === 'signed-out') {
      // A remembered remote device waiting for sign-in: an informational card, never an error.
      if (cloud.status === 'signed-out') return <SignInCard signInAvailable={cloud.signInAvailable} onSignIn={() => void cloud.startSignIn()} onLocal={onLocal} />;
      if (cloud.status === 'signed-in') {
        // The automatic reconnect for this sign-in has not settled yet: the device is queued or about to start. No action is offered.
        if (queueSettledFor !== cloud.readSessionGeneration()) {
          return (
            <div className="bw-banner" role="status" data-testid="queued-reconnect">
              <span className="bw-spinner" aria-hidden="true" /> Waiting to connect…
            </div>
          );
        }
        // Settled: the device is closed and nothing will reconnect it automatically, so the user gets the action.
        return (
          <NoticeCard
            notice={{ kind: 'ended', severity: 'info', title: 'This device is disconnected', summary: 'Reconnect to use it through your Plotune account.', steps: [], technical: '' }}
            actions={
              <button type="button" className="bw-button bw-primary" onClick={() => void store.connect(state.target)}>
                Reconnect
              </button>
            }
          />
        );
      }
      return null;
    }
    if (remote) {
      return (
        <NoticeCard
          notice={state.notice}
          actions={
            <>
              <button type="button" className="bw-button bw-primary" onClick={() => void store.connect(state.target)}>
                Reconnect
              </button>
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
function AddDevicePane({ browser, pageOrigin, startLocal, setStartLocal }: { browser: BrowserInfo; pageOrigin: string } & AddModeProps) {
  const hub = useHub();
  const store = useStore();
  const state = useWorkspace();
  // Starts in the local-network form only when the user asked for it; the request is used up when this pane closes.
  const [mode, setMode] = useState<'account' | 'local'>(() => (startLocal ? 'local' : 'account'));
  const onMode = setMode;
  useEffect(() => () => setStartLocal(false), [setStartLocal]);
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
    // A signed-out remote device is explained by the sign-in card, so the pane does not repeat it.
    const remoteNotice = state.notice && isRemoteTarget(state.target) && state.notice.kind !== 'signed-out' ? state.notice : null;
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
        <AccountDevices onAdvanced={() => onMode('local')} />
        {cancel}
      </div>
    );
  }

  return (
    <div className="bw-add-device">
      <ConnectView browser={browser} pageOrigin={pageOrigin} />
      {!connecting && (
        <>
          <button type="button" className="bw-link-button" onClick={() => onMode('account')}>
            Use my Plotune account
          </button>
          {cancel}
        </>
      )}
    </div>
  );
}

/** The notice when a sign-in failed. The sign-in itself is shown by SignInPending, which replaces the page while it runs. */
function SignInBanner() {
  const cloud = useCloud();
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

/** Lets the sign-in card open the add-device pane straight into the local-network form. */
interface AddModeProps {
  startLocal: boolean;
  setStartLocal: (value: boolean) => void;
}

function WorkspaceBody({ page, onPage, browser, pageOrigin, startLocal, setStartLocal, onLocalNetwork }: { page: PageId; onPage: (page: PageId) => void; browser: BrowserInfo; pageOrigin: string; onLocalNetwork: () => void } & AddModeProps) {
  const diag = useDiagnostics();
  const diagPanels = diagnosticsPanels(diag);
  const { slots, editingId, activeId } = useHubState();
  const editing = editingId !== null && editingId === activeId;
  const bar = (menu?: React.ReactNode) => <WindowBar page={page} onPage={onPage} menu={menu} />;
  return (
    <main className="bw-main" data-page={page}>
      <SignInBanner />
      {editing ? (
        <>{bar()}<AddDevicePane browser={browser} pageOrigin={pageOrigin} startLocal={startLocal} setStartLocal={setStartLocal} /></>
      ) : (
        <>
          {slots.length === 0 && <EmptyIntro />}
          <ConnectionBanner onLocal={onLocalNetwork} />
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

function Workspace({ browser, pageOrigin, onLocalNetwork, ...add }: { browser: BrowserInfo; pageOrigin: string; onLocalNetwork: () => void } & AddModeProps) {
  const { activeId, page } = useHubState();
  const hub = useHub();
  return (
    <ActiveStore>
      <div className="bw-shell">
        <SetupPane />
        <WorkspaceBody key={activeId} page={page} onPage={(next) => hub.setPage(next)} browser={browser} pageOrigin={pageOrigin} onLocalNetwork={onLocalNetwork} {...add} />
      </div>
    </ActiveStore>
  );
}

/**
 * After a sign-in, every remembered remote device that is still waiting for it reconnects, one after another. The queue is
 * rechecked before each device: a device removed from the hub, connected by hand meanwhile, or no longer waiting is skipped.
 * The whole queue stops when the account session changes (sign-out, or a token replaced) or when this component unmounts.
 */
function RememberedReconnect() {
  const cloud = useCloud();
  const hub = useHub();
  const signedIn = cloud.status === 'signed-in';
  const { sessionGeneration, readSessionGeneration } = cloud;
  useEffect(() => {
    if (!signedIn) return undefined;
    const generation = readSessionGeneration();
    const queue = hub.remoteAwaitingSignIn().map((slot) => slot.id);
    if (queue.length === 0) {
      hub.setQueueSettled(generation);
      return undefined;
    }
    let stopped = false;
    queueMicrotask(() => {
      void (async () => {
        try {
          for (const id of queue) {
            if (stopped || readSessionGeneration() !== generation) return;
            const slot = hub.slot(id);
            if (!slot || !hub.isAwaitingSignIn(slot)) continue;
            await slot.store.connect(slot.store.getState().target);
          }
        } finally {
          // Finished, skipped, cancelled or failed: nothing is scheduled any more for this sign-in.
          hub.setQueueSettled(generation);
        }
      })();
    });
    return () => {
      stopped = true;
    };
  }, [signedIn, sessionGeneration, readSessionGeneration, hub]);
  return null;
}

function Shell({ browser, pageOrigin }: { browser: BrowserInfo; pageOrigin: string }) {
  const cloud = useCloud();
  const hub = useHub();
  // Set by the sign-in card's local-network button, and used up when the add-device pane it opens closes.
  const [startLocal, setStartLocal] = useState(false);
  const onLocalNetwork = () => {
    setStartLocal(true);
    hub.editDevice(hub.active.id);
  };
  return (
    <>
      <Topbar showControls />
      <RememberedReconnect />
      {cloud.status === 'signing-in' ? (
        <SignInPending onContinueWithout={cloud.continueWithoutSignIn} />
      ) : (
        <Workspace browser={browser} pageOrigin={pageOrigin} onLocalNetwork={onLocalNetwork} startLocal={startLocal} setStartLocal={setStartLocal} />
      )}
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
