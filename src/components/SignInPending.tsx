// The one calm state while a sign-in runs: the automatic attempt, the return from plotune.net, or the code exchange.
// It replaces the workspace body so no device, notice or add-device pane flashes during the bounce. After 8 seconds it
// says it is still working; after 20 seconds it offers to continue without signing in.
import { useEffect, useState } from 'react';
import logo from '../assets/plotune-logo.png';

export const STILL_WORKING_MS = 8_000;
export const CONTINUE_WITHOUT_MS = 20_000;

/** Copy for the two signing-in phases. Both are announced through the same polite status region below. */
export const SIGNING_IN_MESSAGE = 'Signing you in with your Plotune account…';
/** The honest wording for the brief pre-redirect window, before the browser leaves for plotune.net (BWEB-042 O7). */
export const TAKING_TO_PLOTUNE_MESSAGE = 'Taking you to Plotune to sign in…';

/** The two timers this component uses. Tests pass fake timers; the app uses the browser's. */
export interface PendingTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const browserTimers: PendingTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function SignInPending({ onContinueWithout, message = SIGNING_IN_MESSAGE, timers = browserTimers }: { onContinueWithout: () => void; message?: string; timers?: PendingTimers }) {
  // 0: first line only; 1: "still working" added; 2: the fallback button is offered as well.
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const slow = timers.setTimeout(() => setStage((current) => Math.max(current, 1)), STILL_WORKING_MS);
    const fallback = timers.setTimeout(() => setStage(2), CONTINUE_WITHOUT_MS);
    return () => {
      timers.clearTimeout(slow);
      timers.clearTimeout(fallback);
    };
  }, [timers]);

  return (
    <main className="bw-signing-in" aria-labelledby="signing-in-title">
      <img className="bw-signing-in-logo" src={logo} alt="" />
      <h1 id="signing-in-title">Plotune Bridge</h1>
      <p role="status" aria-live="polite">
        <span className="bw-spinner" aria-hidden="true" /> {message}
      </p>
      {stage >= 1 && <p className="bw-muted">Still working. This can take a few seconds on a slow connection.</p>}
      {stage >= 2 && (
        <div className="bw-actions">
          <button type="button" className="bw-button" onClick={onContinueWithout}>
            Continue without signing in
          </button>
        </div>
      )}
    </main>
  );
}
