import { useEffect, useState } from 'react';
import type { BrowserInfo } from './lib/browser';
import { CloudProvider, useCloud } from './cloud/context';
import type { CloudStatus } from './cloud/context';
import type { CloudClient } from './cloud/client';
import type { CloudSession } from './cloud/session';
import type { SsoBrowser } from './cloud/sso';
import { AccountDevices } from './components/AccountDevices';
import { AccountMenu } from './components/AccountMenu';
import { ConnectView } from './components/ConnectView';
import { IconDevice, IconDiagnose, IconStart, IconStop, IconTrace } from './components/icons';
import { NoticeCard } from './components/Notice';
import { DatabaseMenu } from './components/DatabaseMenu';
import { RecordControl } from './components/RecordControl';
import { RecordingProvider } from './record/context';
import { RecordingService } from './record/recorder';
import { NoticeDock } from './components/NoticeDock';
import { canSourceDescriptor } from './core/can-source';
import { Dashboard, capturePanels, devicePanels, diagnosticsPanels, useDiagnostics, type PageId } from './components/pages';
import { SetupPane } from './components/SetupPane';
import { SignInCard } from './components/SignInCard';
import { SignInPending } from './components/SignInPending';
import { ConnectStatus } from './components/ConnectStatus';
import { RETRY_NOTICE_KINDS } from './transport/notices';
import { DbcProvider, useDbcAssignments } from './dbc/context';
import { DbcRegistry, browserDbcStorage } from './dbc/registry';
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

/** Elapsed time of the running measurement, like the clock in a measurement tool. Counts from when capture started on this page. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Mounted only while capturing, so its mount time is when this measurement started. */
function CaptureTimer() {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="bw-muted bw-capture-timer" role="timer" aria-label="Capture time">
      {formatElapsed(now - startedAt)}
    </span>
  );
}

function Topbar({ showControls }: { showControls: boolean }) {
  const { slots } = useHubState();
  const connected = slots.filter((s) => s.store.getState().phase === 'connected').length;
  const capturing = slots.some((s) => s.store.getState().phase === 'connected' && s.store.getState().capturing);
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
          {capturing && <CaptureTimer />}
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

function ConnectionNotice({ onLocal, dock }: { onLocal: () => void; dock: (label: string, node: React.ReactNode) => React.ReactElement }) {
  const store = useStore();
  const hub = useHub();
  const cloud = useCloud();
  const state = useWorkspace();
  const { queueSettledFor } = useHubState();
  const remote = isRemoteTarget(state.target);
  if (state.phase === 'connecting') {
    if (remote) {
      // The staged connect, with Cancel always visible. Cancel returns to the device list of the add-device pane.
      return dock('Connecting', (
        <section className="bw-card bw-connecting" data-testid="reconnecting">
          <h1 className="bw-eyebrow">Connecting</h1>
          <ConnectStatus stage={state.connectStage} />
          <div className="bw-actions">
            <button type="button" className="bw-button" onClick={() => hub.cancelConnect(hub.active.id)}>
              Cancel
            </button>
          </div>
        </section>
      ));
    }
    return dock('Reconnecting', (
      <div className="bw-banner" role="status" data-testid="reconnecting">
        <span className="bw-spinner" aria-hidden="true" />{' '}
        <>Reconnecting to {state.target}…{state.slowConnect ? ' If your browser asks about local network access, choose Allow.' : ''}</>
      </div>
    ));
  }
  if (state.phase === 'closed' && state.notice) {
    if (remote && state.notice.kind === 'signed-out') {
      // A remembered remote device waiting for sign-in: an informational card, never an error.
      if (cloud.status === 'signed-out') return dock('Sign in to reconnect', <SignInCard signInAvailable={cloud.signInAvailable} onSignIn={() => void cloud.startSignIn()} onLocal={onLocal} />);
      if (cloud.status === 'signed-in') {
        // The automatic reconnect for this sign-in has not settled yet: the device is queued or about to start. No action is offered.
        if (queueSettledFor !== cloud.readSessionGeneration()) {
          return dock('Waiting to connect', (
            <div className="bw-banner" role="status" data-testid="queued-reconnect">
              <span className="bw-spinner" aria-hidden="true" /> Waiting to connect…
            </div>
          ));
        }
        // Settled: the device is closed and nothing will reconnect it automatically, so the user gets the action.
        return dock('Device disconnected', (
          <NoticeCard
            notice={{ kind: 'ended', severity: 'info', title: 'This device is disconnected', summary: 'Reconnect to use it through your Plotune account.', steps: [], technical: '' }}
            actions={
              <button type="button" className="bw-button bw-primary" onClick={() => void store.connect(state.target)}>
                Reconnect
              </button>
            }
          />
        ));
      }
      return null;
    }
    if (remote) {
      // The causes that can be acted on (device, cloud, link) offer Try again; anything else keeps Reconnect.
      const retry = RETRY_NOTICE_KINDS.includes(state.notice.kind);
      return dock(state.notice.title, (
        <NoticeCard
          notice={state.notice}
          actions={
            <>
              <button type="button" className="bw-button bw-primary" onClick={() => void store.connect(state.target)}>
                {retry ? 'Try again' : 'Reconnect'}
              </button>
              <button type="button" className="bw-button" onClick={() => hub.editDevice(hub.active.id)}>
                Choose a device
              </button>
            </>
          }
        />
      ));
    }
    return dock(state.notice.title, (
      <NoticeCard
        notice={state.notice}
        actions={
          <>
            <button type="button" className="bw-button bw-primary" onClick={() => void store.connect(state.target)}>
              Reconnect
            </button>
            <button type="button" className="bw-button" onClick={onLocal}>
              Change address
            </button>
          </>
        }
      />
    ));
  }
  return null;
}

/** Connection messages float over the workspace; see NoticeDock. A new kind of message mounts a fresh, open dock. */
function ConnectionBanner({ onLocal }: { onLocal: () => void }) {
  return <ConnectionNotice onLocal={onLocal} dock={(label, node) => <NoticeDock key={label} label={label}>{node}</NoticeDock>} />;
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
      <div className="bw-windowbar-end">
        {page === 'capture' && <RecordControl />}
        {page === 'capture' && <DatabaseMenu />}
        {menu}
      </div>
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
      <NoticeDock label="Sign-in problem">
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
      </NoticeDock>
    );
  }
  return null;
}

/**
 * The empty workspace: say what to do and give one obvious way to start. Signed out, the way to start is signing in. Signed in,
 * the account is already there, so the intro only asks for a device. The sidebar "+" is easy to miss.
 */
function EmptyIntro() {
  const hub = useHub();
  const cloud = useCloud();
  if (cloud.status === 'signed-in') {
    return (
      <div className="bw-offline-intro" data-testid="empty-intro">
        <h1>Add your first device</h1>
        <p>Pair a Bridge device to your project and connect to it from anywhere. You can also explore the panels offline, or connect on your local network.</p>
        <div className="bw-actions">
          <button type="button" className="bw-button bw-primary" onClick={() => hub.addDevice()}>
            Add a device
          </button>
        </div>
      </div>
    );
  }
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

/**
 * Whether the connection banner is the screen's own title: a remote attempt (its card is headed "Connecting") or the
 * sign-in card for a remote device. Other banners are notices, and the screen then gets a visually hidden heading.
 */
function bannerHasTitle(phase: string, target: string, noticeKind: string | undefined, cloudStatus: CloudStatus): boolean {
  if (!isRemoteTarget(target)) return false;
  if (phase === 'connecting') return true;
  return phase === 'closed' && noticeKind === 'signed-out' && cloudStatus === 'signed-out';
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
  const state = useWorkspace();
  const cloud = useCloud();
  const editing = editingId !== null && editingId === activeId;
  const hasDatabase = useDbcAssignments().length > 0;
  const provides = canSourceDescriptor(state, hasDatabase).provides;
  const bar = (menu?: React.ReactNode) => <WindowBar page={page} onPage={onPage} menu={menu} />;
  // Each screen has exactly one h1: the intro, the banner title, or this hidden one for a workspace with only notices or panels.
  const titled = slots.length === 0 || bannerHasTitle(state.phase, state.target, state.notice?.kind, cloud.status);
  return (
    <main className="bw-main" data-page={page}>
      <SignInBanner />
      {editing ? (
        <>{bar()}<AddDevicePane browser={browser} pageOrigin={pageOrigin} startLocal={startLocal} setStartLocal={setStartLocal} /></>
      ) : (
        <>
          {!titled && <h1 className="bw-sr-only">Plotune Bridge workspace</h1>}
          {slots.length === 0 && <EmptyIntro />}
          <ConnectionBanner onLocal={onLocalNetwork} />
          {page === 'capture' && <Dashboard page="capture" panels={capturePanels} provides={provides} head={bar} />}
          {page === 'diagnostics' && <Dashboard page="diagnostics" panels={diagPanels} provides={provides} head={bar} />}
          {page === 'device' && <Dashboard page="device" panels={devicePanels} provides={provides} head={bar} />}
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
  // Failed attempts are remembered for this page session only, and a session that ends forgets them.
  const signedOut = cloud.status === 'signed-out';
  useEffect(() => {
    if (signedOut) hub.clearFailures();
  }, [signedOut, hub]);
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
      {/* The sign-in screen replaces the workspace, so the measurement controls would act on nothing and crowd a phone top bar. */}
      <Topbar showControls={cloud.status !== 'signing-in'} />
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
  /** Tests inject a registry without storage. The app remembers loaded databases in this browser. */
  dbc?: DbcRegistry;
}

export function App({ hub, browser, pageOrigin = location.origin, cloudClient, cloudSession, cloudSso, dbc }: AppProps) {
  const [registry] = useState(() => dbc ?? new DbcRegistry(browserDbcStorage()));
  const [recording] = useState(() => new RecordingService());
  return (
    <CloudProvider client={cloudClient} session={cloudSession} sso={cloudSso}>
      <HubProvider hub={hub}>
        <DbcProvider registry={registry}>
          <RecordingProvider service={recording}>
            <div className="bw-app">
              <Shell browser={browser} pageOrigin={pageOrigin} />
            </div>
          </RecordingProvider>
        </DbcProvider>
      </HubProvider>
    </CloudProvider>
  );
}
