// The default add-device pane: sign in with a Plotune account (on plotune.net), choose a project, see its devices, connect
// to one through the cloud, or pair a new device with a one-time code. The LAN address form stays behind "Advanced".
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CloudError } from '../cloud/client';
import { useCloud } from '../cloud/context';
import { useHub, useHubState, useStore } from '../state/context';
import { REMOTE_TARGET_PREFIX } from '../transport/remote';
import { IconCheck, IconCopy } from './icons';

const PAIRING_LIFETIME_NOTE = 'Enter this code on your Bridge device within 2 minutes.';
const POLL_INTERVAL_MS = 3000;
const TICK_INTERVAL_MS = 1000;
const COPIED_MS = 1500;

function pairingMessage(error: unknown): string {
  if (!(error instanceof CloudError)) return 'Could not create a pairing code. Try again.';
  if (error.code === 'forbidden') return 'Only project owners and admins can add devices.';
  if (error.code === 'unauthorized') return 'Your sign-in has expired. Sign in again.';
  return error.message;
}

/** An inline message in the existing notice style. Errors are announced at once; warnings politely. */
function Alert({ tone, id, children }: { tone: 'error' | 'warning'; id?: string; children: ReactNode }) {
  return (
    <div id={id} className={`bw-notice bw-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="bw-notice-body">
        <p>{children}</p>
      </div>
    </div>
  );
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "3 hours ago" style text for a time in milliseconds, relative to `now`. */
function agoText(time: number, now: number): string {
  const seconds = Math.round((time - now) / 1000);
  if (Math.abs(seconds) < 60) return 'just now';
  const units = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ] as const;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** "3 hours ago" style text for a pairing time. Falls back to "recently" for a value that is not a date. */
function pairedAgo(iso: string, now: number): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 'recently' : agoText(time, now);
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

interface PairingState {
  projectId: string;
  code: string;
  expiresAtMs: number;
  /** Device UUIDs that were already paired when the code was made; a new one means the code worked. */
  knownDeviceIds: string[];
}

function SignedInPanel({ onAdvanced }: { onAdvanced: () => void }) {
  const cloud = useCloud();
  const store = useStore();
  const hub = useHub();
  const { slots } = useHubState();
  const { projects, projectsLoading, projectsError, selectedProjectId, devices, devicesLoading, devicesLoaded, devicesError } = cloud;
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Relative times in the device list ("tried 2 minutes ago") are refreshed every 30 seconds.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  // Which copy button was used last, for its "Copied" feedback. The project ID is not a secret; account tokens are never shown.
  const [copied, setCopied] = useState<'code' | 'project' | null>(null);
  // The "Add a device" button comes back when a code ends (Done or Cancel), where the focused button just disappeared.
  const addRef = useRef<HTMLButtonElement>(null);
  const restoreAddFocus = useRef(false);
  useEffect(() => {
    if (pairing === null && restoreAddFocus.current) {
      restoreAddFocus.current = false;
      addRef.current?.focus();
    }
  }, [pairing]);

  // A code belongs to the project it was made for; switching projects drops it from view.
  const current = pairing !== null && pairing.projectId === selectedProjectId ? pairing : null;
  const added = current !== null && devices.some((device) => !current.knownDeviceIds.includes(device.deviceUuid));
  const expired = current !== null && !added && now >= current.expiresAtMs;
  const waiting = current !== null && !added && !expired;
  const { refreshDevices } = cloud;

  // While a code is waiting, the countdown ticks each second and the device list is refreshed every 3 seconds.
  useEffect(() => {
    if (!waiting) return undefined;
    const tick = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    const poll = setInterval(() => void refreshDevices(), POLL_INTERVAL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [waiting, refreshDevices]);

  const startPairing = async () => {
    const projectId = selectedProjectId;
    // The baseline must be a list that really loaded, or a device paired long ago would count as the one this code made.
    if (projectId === null || pairBusy || !devicesLoaded) return;
    setPairBusy(true);
    setPairError(null);
    setCopied(null);
    try {
      const token = await cloud.createPairingCode();
      setNow(Date.now());
      setPairing({ projectId, code: token.pairingToken, expiresAtMs: token.expiresAt * 1000, knownDeviceIds: devices.map((d) => d.deviceUuid) });
    } catch (failure) {
      setPairError(pairingMessage(failure));
    } finally {
      setPairBusy(false);
    }
  };

  const copyText = (value: string, what: 'code' | 'project') => {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    void clipboard.writeText(value).then(
      () => {
        setCopied(what);
        setTimeout(() => setCopied((current) => (current === what ? null : current)), COPIED_MS);
      },
      () => undefined,
    );
  };

  const projectName = projects.find((p) => p.id === selectedProjectId)?.name;
  const connect = (deviceUuid: string) => {
    if (selectedProjectId === null) return;
    void store.connect(`${REMOTE_TARGET_PREFIX}${selectedProjectId}/${deviceUuid}`);
  };

  return (
    <>
      <div className="bw-account-bar">
        <span className="bw-account-state">
          <IconCheck aria-hidden="true" /> Signed in
        </span>
        <button type="button" className="bw-button bw-small" onClick={() => cloud.signOut()}>
          Sign out
        </button>
      </div>

      <div className="bw-field">
        <label htmlFor="project-select">Project</label>
        <select
          id="project-select"
          value={selectedProjectId ?? ''}
          onChange={(e) => cloud.selectProject(e.target.value)}
          disabled={projects.length === 0}
        >
          <option value="" disabled>
            {projectsLoading ? 'Loading projects…' : 'Choose a project'}
          </option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      {selectedProjectId !== null && current === null && (
        // While a pairing code is shown, the code card carries the project ID, so the copy button is not repeated here.
        <p className="bw-muted bw-project-id-line">
          Project ID: <span className="bw-mono">{selectedProjectId}</span>{' '}
          <button type="button" className="bw-button bw-small" onClick={() => copyText(selectedProjectId, 'project')} aria-label="Copy project ID">
            {copied === 'project' ? <IconCheck aria-hidden="true" /> : <IconCopy aria-hidden="true" />} {copied === 'project' ? 'Copied' : 'Copy'}
          </button>
        </p>
      )}
      {projectsError && (
        <Alert tone="error">
          {projectsError.message}
        </Alert>
      )}
      {!projectsLoading && !projectsError && projects.length === 0 && (
        <p className="bw-lead">
          You have no projects yet. Create one at{' '}
          <a href="https://www.plotune.net/stream/workspace" target="_blank" rel="noopener noreferrer">
            https://www.plotune.net/stream/workspace
          </a>
        </p>
      )}

      {selectedProjectId !== null && (
        <section className="bw-devices" aria-labelledby="devices-heading">
          <div className="bw-devices-head">
            <h2 id="devices-heading">Devices{projectName ? ` in ${projectName}` : ''}</h2>
            <button ref={addRef} type="button" className="bw-button bw-small" onClick={() => void startPairing()} disabled={pairBusy || waiting || !devicesLoaded}>
              Add a device
            </button>
          </div>

          {pairError && (
            <Alert tone="error">
              {pairError}
            </Alert>
          )}

          {current && added && (
            <div className="bw-pairing bw-pairing-done">
              <p role="status" className="bw-lead">
                <IconCheck aria-hidden="true" /> Device added
              </p>
              <div className="bw-actions">
                <button type="button" className="bw-button bw-primary bw-small" onClick={() => { restoreAddFocus.current = true; setPairing(null); }}>
                  Done
                </button>
              </div>
            </div>
          )}

          {current && waiting && (
            <div className="bw-pairing" role="group" aria-label="Pairing code">
              <p className="bw-eyebrow">Pairing code</p>
              <code className="bw-pairing-code">{current.code}</code>
              <div className="bw-actions">
                <button type="button" className="bw-button bw-small" onClick={() => copyText(current.code, 'code')} aria-label="Copy pairing code">
                  {copied === 'code' ? <IconCheck aria-hidden="true" /> : <IconCopy aria-hidden="true" />} {copied === 'code' ? 'Copied' : 'Copy'}
                </button>
                <span className="bw-muted">Expires in {countdown(current.expiresAtMs - now)}</span>
              </div>
              <div className="bw-project-id-row">
                <span className="bw-muted">Project ID</span>
                <span className="bw-mono bw-project-id-value">{selectedProjectId}</span>
                <button type="button" className="bw-button bw-small" onClick={() => copyText(selectedProjectId ?? '', 'project')} aria-label="Copy project ID">
                  {copied === 'project' ? <IconCheck aria-hidden="true" /> : <IconCopy aria-hidden="true" />} {copied === 'project' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="bw-hint">Enter this project ID and the code on your device.</p>
              <p>{PAIRING_LIFETIME_NOTE}</p>
              <p role="status" className="bw-hint">
                Waiting for your device…
              </p>
              <div className="bw-actions">
                <button type="button" className="bw-button bw-small" onClick={() => { restoreAddFocus.current = true; setPairing(null); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {current && expired && (
            <div className="bw-pairing">
              <Alert tone="warning">
                Code expired
              </Alert>
              <div className="bw-actions">
                <button type="button" className="bw-button bw-primary bw-small" onClick={() => void startPairing()} disabled={pairBusy}>
                  Get a new code
                </button>
              </div>
            </div>
          )}

          {devicesLoading && devices.length === 0 && <p className="bw-muted">Loading devices…</p>}
          {devicesError && (
            <Alert tone="error">
              {devicesError.message}{' '}
              {/* Adding a device waits for a loaded list, so a failed load needs its own way to try again. */}
              <button type="button" className="bw-button bw-small" onClick={() => void cloud.refreshDevices()} disabled={devicesLoading}>
                Try again
              </button>
            </Alert>
          )}
          {!devicesLoading && !devicesError && devices.length === 0 && <p className="bw-muted">No devices paired to this project yet.</p>}
          {devices.length > 0 && (
            <ul className="bw-device-list" aria-label="Devices in this project">
              {devices.map((device) => {
                // Only what this page knows: the cloud has no presence data, so a device is never called online or offline.
                const target = `${REMOTE_TARGET_PREFIX}${selectedProjectId}/${device.deviceUuid}`;
                const phase = slots.find((slot) => slot.store.getState().target === target)?.store.getState().phase;
                const connecting = phase === 'connecting';
                const connected = phase === 'connected';
                const failedAt = hub.lastFailureAt(target);
                const unreachable = !connecting && !connected && failedAt !== null;
                const status = connecting
                  ? 'Connecting…'
                  : connected
                    ? 'Connected'
                    : unreachable
                      ? `Not reachable · tried ${agoText(failedAt, now)}`
                      : `${device.deviceType} · Paired ${pairedAgo(device.pairedAt, now)}`;
                return (
                  <li key={device.deviceUuid} className="bw-device-row">
                    <div className="bw-device-info">
                      <span className="bw-mono">{device.deviceId || 'Bridge device'}</span>
                      <span className="bw-muted">{status}</span>
                    </div>
                    <button type="button" className="bw-button bw-primary bw-small" onClick={() => connect(device.deviceUuid)} disabled={connecting || connected}>
                      {unreachable ? 'Try again' : 'Connect'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <div className="bw-card-footer">
        <button type="button" className="bw-link-button" onClick={onAdvanced}>
          Advanced: connect on the local network instead
        </button>
      </div>
    </>
  );
}

/** The add-device pane for Plotune accounts. `onAdvanced` switches to the local-network address form. */
export function AccountDevices({ onAdvanced }: { onAdvanced: () => void }) {
  const cloud = useCloud();
  const signedIn = cloud.status === 'signed-in';
  // Opened from the empty workspace's button, which is gone once the pane shows: focus goes to the pane title.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) titleRef.current?.focus();
  }, []);
  // After Sign out in this pane the focused button is gone: focus goes to Continue with Plotune, the next step.
  const continueRef = useRef<HTMLButtonElement>(null);
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    const active = document.activeElement;
    if (wasSignedIn.current && !signedIn && (active === null || active === document.body)) continueRef.current?.focus();
    wasSignedIn.current = signedIn;
  }, [signedIn]);
  return (
    <section className="bw-card bw-account" aria-labelledby="account-title">
      <p className="bw-eyebrow">Plotune account</p>
      <h1 id="account-title" ref={titleRef} tabIndex={-1}>
        {signedIn ? 'Connect a Bridge device' : 'Sign in to connect your Bridge'}
      </h1>
      {signedIn ? (
        <SignedInPanel onAdvanced={onAdvanced} />
      ) : (
        <>
          <p className="bw-lead">
            Sign in with your Plotune account. Plotune opens its own sign-in page, then brings you back here already signed in.
          </p>
          <div className="bw-actions">
            <button ref={continueRef} type="button" className="bw-button bw-primary" onClick={() => void cloud.startSignIn()} disabled={cloud.status === 'signing-in'}>
              Continue with Plotune
            </button>
          </div>
          <p className="bw-fine">
            No account yet? <a href="https://www.plotune.net/register" target="_blank" rel="noopener noreferrer">Create an account</a>
          </p>
          <div className="bw-card-footer">
            <button type="button" className="bw-link-button" onClick={onAdvanced}>
              Advanced: connect on the local network instead
            </button>
          </div>
        </>
      )}
    </section>
  );
}
