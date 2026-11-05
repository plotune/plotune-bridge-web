import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BrowserInfo } from './lib/browser';
import { CloudProvider, useCloud } from './cloud/context';
import type { CloudStatus } from './cloud/context';
import type { CloudClient } from './cloud/client';
import type { CloudSession } from './cloud/session';
import type { SsoBrowser } from './cloud/sso';
import type { PaintScheduler } from './cloud/paint';
import { AccountDevices } from './components/AccountDevices';
import { AccountMenu } from './components/AccountMenu';
import { ConnectView } from './components/ConnectView';
import { IconStart, IconStop } from './components/icons';
import { NoticeCard } from './components/Notice';
import { DeviceSettings } from './components/DeviceSettings';
import { Explorer } from './components/Explorer';
import { RecordControl } from './components/RecordControl';
import { RecordingProvider } from './record/context';
import { RecordingService } from './record/recorder';
import { NoticeDock } from './components/NoticeDock';
import { AnalysisProvider, useAnalysis } from './analysis/context';
import { ProjectProvider } from './workspace/context';
import { DiagnosticsProvider } from './workspace/diagnostics';
import { ProjectStore } from './workspace/project';
import { OpenSettingsContext } from './workspace/context';
import { ToastProvider, useToast } from './workspace/ui';
import { AddPanelButton, CanvasTabs, CanvasView, CommandButton, ExplorerToggle, WorkspaceUiProvider, useSheet } from './workspace/WorkspaceCanvas';
import { SignInCard } from './components/SignInCard';
import { SignInPending } from './components/SignInPending';
import { ConnectStatus } from './components/ConnectStatus';
import { RETRY_NOTICE_KINDS } from './transport/notices';
import { DbcProvider } from './dbc/context';
import { DbcRegistry, browserDbcStorage } from './dbc/registry';
import { HubProvider, StoreProvider, useHub, useHubState, useStore, useWorkspace } from './state/context';
import type { DeviceHub } from './state/hub';
import { isRemoteTarget } from './transport/remote';
import logo from './assets/plotune-logo.png';

/** Start and stop for every connected device at once, as one measurement. */
function MeasurementControls() {
  const hub = useHub();
  const { slots } = useHubState();
  const states = slots.map((s) => s.store.getState());
  const connected = states.filter((s) => s.phase === 'connected');
  const capturing = connected.some((s) => s.capturing);
  const busy = states.some((s) => s.busy);
  const toast = useToast();
  // The reason a start was refused is shown next to the device in the explorer, and here too, since the explorer may be closed.
  const start = async () => {
    await hub.startAll();
    const refused = hub.getState().slots.map((s) => s.store.getState().actionError).find((e): e is string => !!e);
    if (refused) toast.show(refused);
  };
  return capturing ? (
    <button type="button" className="bw-icon-button bw-capture is-on" onClick={() => void hub.stopAll()} disabled={busy} aria-label="Stop capture" title="Stop capture">
      <IconStop />
    </button>
  ) : (
    <button type="button" className="bw-icon-button bw-capture" onClick={() => void start()} disabled={connected.length === 0 || busy} aria-label="Start capture" title={connected.length === 0 ? 'Connect a device to capture' : 'Start capture on every connected device'}>
      <IconStart />
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

function Topbar({ showControls, explorerOpen }: { showControls: boolean; explorerOpen: boolean }) {
  const { slots } = useHubState();
  const capturing = slots.some((s) => s.store.getState().phase === 'connected' && s.store.getState().capturing);
  return (
    <header className="bw-topbar">
      {showControls && <ExplorerToggle open={explorerOpen} />}
      <a className="bw-brand" href="https://plotune.net" aria-label="Plotune" title="Plotune">
        <img className="bw-brand-logo" src={logo} alt="" />
      </a>
      {showControls && <CanvasTabs />}
      <div className="bw-top-end">
        {showControls && (
          <>
            <AddPanelButton />
            <CommandButton />
            <span className="bw-top-divider" />
            <RecordControl />
            <MeasurementControls />
            {capturing && <CaptureTimer />}
          </>
        )}
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

function WorkspaceBody({ browser, pageOrigin, startLocal, setStartLocal, onLocalNetwork }: { browser: BrowserInfo; pageOrigin: string; onLocalNetwork: () => void } & AddModeProps) {
  const { editingId, activeId } = useHubState();
  const state = useWorkspace();
  const cloud = useCloud();
  const editing = editingId !== null && editingId === activeId;
  // Each screen has exactly one h1: the banner title, or this hidden one.
  const titled = bannerHasTitle(state.phase, state.target, state.notice?.kind, cloud.status);
  return (
    <main className="bw-main">
      <SignInBanner />
      {editing ? (
        <AddDevicePane browser={browser} pageOrigin={pageOrigin} startLocal={startLocal} setStartLocal={setStartLocal} />
      ) : (
        <>
          {!titled && <h1 className="bw-sr-only">Plotune Bridge workspace</h1>}
          <ConnectionBanner onLocal={onLocalNetwork} />
          <CanvasView />
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

function Workspace({ browser, pageOrigin, onLocalNetwork, explorerOpen, closeExplorer, settingsFor, closeSettings, ...add }: { browser: BrowserInfo; pageOrigin: string; onLocalNetwork: () => void; explorerOpen: boolean; closeExplorer: () => void; settingsFor: string | null; closeSettings: () => void } & AddModeProps) {
  const { activeId } = useHubState();
  const sheet = useSheet();
  return (
    <ActiveStore>
      <DiagnosticsProvider>
        <div className={`bw-shell ${explorerOpen ? 'has-explorer' : ''}`}>
          {explorerOpen && <Explorer onAway={closeExplorer} />}
          {explorerOpen && sheet && <div className="bw-scrim" onClick={closeExplorer} aria-hidden="true" />}
          <WorkspaceBody key={activeId} browser={browser} pageOrigin={pageOrigin} onLocalNetwork={onLocalNetwork} {...add} />
        </div>
        {settingsFor !== null && <DeviceSettings deviceId={settingsFor} onClose={closeSettings} />}
      </DiagnosticsProvider>
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

const EXPLORER_KEY = 'bw.explorer';
const readExplorer = (): boolean | null => {
  try { const v = localStorage.getItem(EXPLORER_KEY); return v === 'open' ? true : v === 'closed' ? false : null; } catch { return null; }
};

function Shell({ browser, pageOrigin }: { browser: BrowserInfo; pageOrigin: string }) {
  const cloud = useCloud();
  const hub = useHub();
  // Set by the sign-in card's local-network button, and used up when the add-device pane it opens closes.
  const [startLocal, setStartLocal] = useState(false);
  const onLocalNetwork = () => {
    setStartLocal(true);
    hub.editDevice(hub.active.id);
  };
  // Beside the canvas on a wide screen (open unless the user closed it, and that is remembered), and floating over it on a
  // narrow one (closed until asked for, and never remembered).
  const sheet = useSheet();
  const [wideChoice, setWideChoice] = useState<boolean | null>(readExplorer);
  const [floating, setFloating] = useState(false);
  const explorerOpen = sheet ? floating : (wideChoice ?? true);
  const toggleExplorer = useCallback(() => {
    if (sheet) { setFloating(!floating); return; }
    const next = !(wideChoice ?? true);
    setWideChoice(next);
    try { localStorage.setItem(EXPLORER_KEY, next ? 'open' : 'closed'); } catch { /* not remembered */ }
  }, [sheet, floating, wideChoice]);
  const closeExplorer = useCallback(() => setFloating(false), []);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const openSettings = useCallback((id?: string) => setSettingsFor(id ?? hub.active.id), [hub]);
  const { slots } = useHubState();
  const { pickFile } = useAnalysis();
  const extraCommands = useMemo(() => [...slots.map((slot) => ({ label: `Settings: ${slot.label}`, group: 'Device', run: () => setSettingsFor(slot.id) })), { label: 'Open a log or CSV file to analyse…', group: 'Analyze', run: pickFile }], [slots, pickFile]);
  return (
    <OpenSettingsContext.Provider value={openSettings}>
      <WorkspaceUiProvider onToggleExplorer={toggleExplorer} extraCommands={extraCommands}>
        {/* The sign-in screen replaces the workspace, so the measurement controls would act on nothing and crowd a phone top bar. */}
        <Topbar showControls={cloud.status !== 'signing-in'} explorerOpen={explorerOpen} />
        <RememberedReconnect />
        {cloud.status === 'signing-in' ? (
          <SignInPending onContinueWithout={cloud.continueWithoutSignIn} message={cloud.pendingMessage ?? undefined} />
        ) : (
          <Workspace browser={browser} pageOrigin={pageOrigin} onLocalNetwork={onLocalNetwork} startLocal={startLocal} setStartLocal={setStartLocal} explorerOpen={explorerOpen} closeExplorer={closeExplorer} settingsFor={settingsFor} closeSettings={() => setSettingsFor(null)} />
        )}
      </WorkspaceUiProvider>
    </OpenSettingsContext.Provider>
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
  /** Tests inject a scheduler they can step deterministically; the app paints with real animation frames. */
  cloudPaintScheduler?: PaintScheduler;
  /** Tests inject a registry without storage. The app remembers loaded databases in this browser. */
  dbc?: DbcRegistry;
  /** Tests inject a project store without storage. The app saves projects in this browser. */
  project?: ProjectStore;
}

export function App({ hub, browser, pageOrigin = location.origin, cloudClient, cloudSession, cloudSso, cloudPaintScheduler, dbc, project }: AppProps) {
  const [projects] = useState(() => project ?? new ProjectStore());
  const [registry] = useState(() => dbc ?? new DbcRegistry(browserDbcStorage()));
  const [recording] = useState(() => new RecordingService());
  return (
    <CloudProvider client={cloudClient} session={cloudSession} sso={cloudSso} paintScheduler={cloudPaintScheduler}>
      <HubProvider hub={hub}>
        <DbcProvider registry={registry}>
          <RecordingProvider service={recording}>
            <ProjectProvider store={projects}>
              <ToastProvider>
                <AnalysisProvider>
                  <div className="bw-app">
                    <Shell browser={browser} pageOrigin={pageOrigin} />
                  </div>
                </AnalysisProvider>
              </ToastProvider>
            </ProjectProvider>
          </RecordingProvider>
        </DbcProvider>
      </HubProvider>
    </CloudProvider>
  );
}
