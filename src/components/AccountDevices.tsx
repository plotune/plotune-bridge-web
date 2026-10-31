// The default add-device pane: sign in with a Plotune account, choose a project, see its devices, connect to one through
// the cloud, or pair a new device with a one-time code. The LAN address form stays available behind "Advanced".
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CloudError } from '../cloud/client';
import { useCloud } from '../cloud/context';
import { useStore } from '../state/context';
import { REMOTE_TARGET_PREFIX } from '../transport/remote';
import { IconCheck, IconCopy } from './icons';

const PAIRING_LIFETIME_NOTE = 'Enter this code on your Bridge device within 2 minutes.';
const POLL_INTERVAL_MS = 3000;
const TICK_INTERVAL_MS = 1000;
const COPIED_MS = 1500;

function signInMessage(error: unknown): string {
  if (!(error instanceof CloudError)) return 'Sign-in failed. Try again.';
  switch (error.code) {
    case 'bad-credentials':
      return 'The username or password is not correct.';
    case 'service-unavailable':
      return 'Sign-in is temporarily unavailable, try again shortly.';
    case 'network':
      return 'Could not reach Plotune. Check your connection and try again.';
    case 'rate-limited':
      return 'Too many attempts. Wait a few minutes and try again.';
    default:
      return 'Sign-in failed. Try again.';
  }
}

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

/** "3 hours ago" style text for a pairing time. Falls back to "recently" for a value that is not a date. */
function pairedAgo(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 'recently';
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

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

interface SignInFormProps {
  busy: boolean;
  onSignIn: (usernameOrEmail: string, password: string) => Promise<void>;
}

function SignInForm({ busy, onSignIn }: SignInFormProps) {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = usernameOrEmail.trim();
    const nextUsernameError = name === '' ? 'Enter your username or email.' : null;
    const nextPasswordError = password === '' ? 'Enter your password.' : null;
    setUsernameError(nextUsernameError);
    setPasswordError(nextPasswordError);
    if (nextUsernameError || nextPasswordError) return;
    // The password leaves the field as soon as it is submitted, whatever the outcome.
    const secret = password;
    setPassword('');
    setError(null);
    onSignIn(name, secret).catch((failure: unknown) => setError(signInMessage(failure)));
  };

  return (
    <>
      <form className="bw-form" onSubmit={submit} noValidate aria-describedby={error ? 'account-error' : undefined}>
        <label htmlFor="account-user">Username or email</label>
        <input
          id="account-user"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={usernameOrEmail}
          onChange={(e) => setUsernameOrEmail(e.target.value)}
          aria-invalid={usernameError !== null}
          aria-describedby={usernameError ? 'account-user-error' : undefined}
          disabled={busy}
        />
        {usernameError && (
          <p id="account-user-error" className="bw-hint">
            {usernameError}
          </p>
        )}
        <label htmlFor="account-password">Password</label>
        <input
          id="account-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={passwordError !== null}
          aria-describedby={passwordError ? 'account-password-error' : undefined}
          disabled={busy}
        />
        {passwordError && (
          <p id="account-password-error" className="bw-hint">
            {passwordError}
          </p>
        )}
        <div className="bw-actions">
          <button type="submit" className="bw-button bw-primary" disabled={busy} aria-busy={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
      <div role="status" aria-live="polite">
        {error && (
          <Alert tone="error" id="account-error">
            {error}
          </Alert>
        )}
      </div>
      <p className="bw-fine">
        No account yet? <a href="https://www.plotune.net" target="_blank" rel="noopener noreferrer">Create an account</a>
      </p>
    </>
  );
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
  const { projects, projectsLoading, projectsError, selectedProjectId, devices, devicesLoading, devicesLoaded, devicesError } = cloud;
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

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
    setCopied(false);
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

  const copyCode = (code: string) => {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    void clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_MS);
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
            <button type="button" className="bw-button bw-small" onClick={() => void startPairing()} disabled={pairBusy || waiting || !devicesLoaded}>
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
                <button type="button" className="bw-button bw-primary bw-small" onClick={() => setPairing(null)}>
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
                <button type="button" className="bw-button bw-small" onClick={() => copyCode(current.code)}>
                  {copied ? <IconCheck aria-hidden="true" /> : <IconCopy aria-hidden="true" />} {copied ? 'Copied' : 'Copy'}
                </button>
                <span className="bw-muted">Expires in {countdown(current.expiresAtMs - now)}</span>
              </div>
              <p>{PAIRING_LIFETIME_NOTE}</p>
              <p role="status" className="bw-hint">
                Waiting for your device…
              </p>
              <div className="bw-actions">
                <button type="button" className="bw-button bw-small" onClick={() => setPairing(null)}>
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
              {devicesError.message}
            </Alert>
          )}
          {!devicesLoading && !devicesError && devices.length === 0 && <p className="bw-muted">No devices paired to this project yet.</p>}
          {devices.length > 0 && (
            <ul className="bw-device-list" aria-label="Devices in this project">
              {devices.map((device) => (
                <li key={device.deviceUuid} className="bw-device-row">
                  <div className="bw-device-info">
                    <span className="bw-mono">{device.deviceId || 'Bridge device'}</span>
                    <span className="bw-muted">
                      {device.deviceType} · Paired {pairedAgo(device.pairedAt, now)}
                    </span>
                  </div>
                  <button type="button" className="bw-button bw-primary bw-small" onClick={() => connect(device.deviceUuid)}>
                    Connect
                  </button>
                </li>
              ))}
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
  return (
    <section className="bw-card bw-account" aria-labelledby="account-title">
      <p className="bw-eyebrow">Plotune account</p>
      <h1 id="account-title">{signedIn ? 'Connect a Bridge device' : 'Sign in to connect your Bridge'}</h1>
      {signedIn ? (
        <SignedInPanel onAdvanced={onAdvanced} />
      ) : (
        <>
          <SignInForm busy={cloud.status === 'signing-in'} onSignIn={cloud.signIn} />
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
