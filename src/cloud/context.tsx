// React access to the Plotune account: sign-in through plotune.net, the project list, the selected project and its devices.
// The account token lives only in the session (memory). The only thing written to storage is the selected project ID,
// plus the sign-in flags and the PKCE verifier/state that sso.ts keeps in sessionStorage for the round trip.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { readStored, removeStored, writeStored } from '../lib/storage';
import { createCloudClient, CloudError, type CloudClient, type CloudDevice, type CloudProject, type PairingToken } from './client';
import { cloudSession, type CloudSession } from './session';
import {
  buildAuthorizeUrl,
  clearPending,
  clearSignedOutThisTab,
  createBrowserSso,
  createPkce,
  clearSilentFailed,
  markSignedOutThisTab,
  markSilentFailed,
  parseCallbackHash,
  randomState,
  readPending,
  savePending,
  signedOutThisTab,
  silentAttemptFailed,
  ssoSupported,
  type SignInPrompt,
  type SsoBrowser,
} from './sso';

export const SELECTED_PROJECT_KEY = 'bw.cloud.project';
const MAX_ID_LENGTH = 128;

/** Friendly, fixed sign-in notices. None of them contains a code, token, state or verifier. */
export const SIGN_IN_NOT_COMPLETED = 'Sign-in could not be completed. Try again.';
export const SIGN_IN_EXPIRED = 'Sign-in expired. Try again.';
export const SIGN_IN_CANCELLED = 'Sign-in was cancelled. Try again when you are ready.';
export const SIGN_IN_UNSUPPORTED_ORIGIN = 'Sign-in with a Plotune account works on bridge.plotune.net. On this address you can still connect to a device on your local network.';
export const SIGN_IN_NEEDS_STORAGE ='Sign-in needs this tab to keep a little browser storage. Allow site data for this page and try again.';

export type CloudStatus = 'signed-out' | 'signing-in' | 'signed-in';

export interface CloudContextValue {
  status: CloudStatus;
  /** The username from the last successful sign-in, while signed in. */
  username: string | null;
  /** A fixed notice about a failed or abandoned sign-in, or null. */
  signInNotice: string | null;
  dismissSignInNotice(): void;
  /** Redirects the browser to plotune.net. 'login' asks plotune.net for its login form even if a session exists. */
  startSignIn(prompt?: 'login'): Promise<void>;
  /** Forgets the account in this page only. plotune.net is not touched, and this tab will not sign in silently again. */
  signOut(): void;
  /** False off bridge.plotune.net: sign-in cannot complete there, so the page offers the local network instead. */
  signInAvailable: boolean;
  /** Moves on with every change of the account session. A job started for one session must stop when this changes. */
  sessionGeneration(): number;
  /** The fallback on the sign-in screen: stops the automatic attempt for this tab and shows the workspace. */
  continueWithoutSignIn(): void;
  projects: CloudProject[];
  projectsLoading: boolean;
  projectsError: CloudError | null;
  selectedProjectId: string | null;
  selectProject(projectId: string): void;
  /** Devices of the selected project only. Empty while none is selected. */
  devices: CloudDevice[];
  devicesLoading: boolean;
  /** True once the list for the selected project has loaded successfully; pairing needs this as its baseline. */
  devicesLoaded: boolean;
  devicesError: CloudError | null;
  refreshDevices(): Promise<void>;
  /** Rejects with CloudError. The code is returned to the caller only; it is never stored. */
  createPairingCode(): Promise<PairingToken>;
}

const CloudContext = createContext<CloudContextValue | null>(null);
const defaultClient: CloudClient = createCloudClient();
const defaultSso: SsoBrowser = createBrowserSso();

interface ListState<T> {
  items: T[];
  loading: boolean;
  error: CloudError | null;
}

function readSelectedProject(): string | null {
  const value = readStored(SELECTED_PROJECT_KEY);
  return value !== null && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : null;
}

function rememberProject(projectId: string | null): void {
  if (projectId === null) removeStored(SELECTED_PROJECT_KEY);
  else writeStored(SELECTED_PROJECT_KEY, projectId);
}

function asCloudError(error: unknown): CloudError {
  return error instanceof CloudError ? error : new CloudError('bad-response');
}

type BootPlan = 'callback' | 'auto' | 'stale' | 'none';

/**
 * What the page does on load, decided from storage and the address bar only. It is read on the first render, so the page
 * can show the sign-in state before the effect starts the redirect or the callback. The effect acts on this plan.
 */
function planBoot(sso: SsoBrowser, hash: string, hasSession: boolean): BootPlan {
  if (hash !== '') return 'callback';
  if (!ssoSupported(sso) || hasSession || sso.storage === null) return 'none';
  if (signedOutThisTab(sso.storage) || silentAttemptFailed(sso.storage)) return 'none';
  // A pending pair with no fragment means an earlier attempt never came back (back button, closed tab, a page in between).
  return readPending(sso.storage) !== null ? 'stale' : 'auto';
}

export interface CloudProviderProps {
  children: ReactNode;
  /** Injected by tests; the app uses the real client, the app-wide session and the browser's sign-in hooks. */
  client?: CloudClient;
  session?: CloudSession;
  sso?: SsoBrowser;
}

export function CloudProvider({ children, client = defaultClient, session = cloudSession, sso = defaultSso }: CloudProviderProps) {
  // The token is read from the session on every render; subscribing keeps the status current when it expires or is cleared.
  const signedIn = useSyncExternalStore(session.subscribe, () => session.getToken() !== null);
  const [redirecting, setRedirecting] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [signInNotice, setSignInNotice] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(readSelectedProject);
  const [projectState, setProjectState] = useState<ListState<CloudProject>>({ items: [], loading: false, error: null });
  const [deviceState, setDeviceState] = useState<ListState<CloudDevice> & { projectId: string | null; loaded: boolean }>({ items: [], loading: false, error: null, projectId: null, loaded: false });
  // Read by the async loaders when a response arrives, so a late answer for an old project or session is dropped.
  const selectedRef = useRef<string | null>(selectedProjectId);
  const deviceEpoch = useRef(0);
  // One device-list request per project and session at a time. A caller that asks while one is running (the pairing poll
  // on a slow connection) shares it, instead of starting another that would make the running response look stale.
  const deviceRequest = useRef<{ projectId: string; token: string; promise: Promise<void> } | null>(null);
  // The fragment is read once per page load; StrictMode runs effects twice and a one-time code can be used only once.
  const bootstrapped = useRef(false);
  // Identifies the newest callback exchange; the fallback moves it on so an older exchange cannot change the page.
  const callbackRun = useRef(0);
  const sessionGeneration = useRef(0);
  const [boot] = useState(() => {
    const hash = sso.readHash();
    return { hash, plan: planBoot(sso, hash, session.getToken() !== null) };
  });
  // True from the first render while a callback or an automatic attempt is about to run, so no workspace flashes.
  const [bootPending, setBootPending] = useState(() => boot.plan === 'callback' || boot.plan === 'auto');

  const loadDevices = useCallback(
    (projectId: string): Promise<void> => {
      const token = session.getToken();
      if (token === null) return Promise.resolve();
      const running = deviceRequest.current;
      if (running !== null && running.projectId === projectId && running.token === token) return running.promise;
      const epoch = ++deviceEpoch.current;
      setDeviceState((prev) => {
        const same = prev.projectId === projectId;
        return { projectId, items: same ? prev.items : [], loading: true, error: null, loaded: same && prev.loaded };
      });
      const entry = { projectId, token, promise: Promise.resolve() };
      deviceRequest.current = entry;
      entry.promise = (async () => {
        try {
          const items = await client.listDevices(token, projectId);
          if (epoch !== deviceEpoch.current || session.getToken() !== token) return;
          setDeviceState({ projectId, items, loading: false, error: null, loaded: true });
        } catch (error) {
          if (epoch !== deviceEpoch.current || session.getToken() !== token) return;
          setDeviceState({ projectId, items: [], loading: false, error: asCloudError(error), loaded: false });
        } finally {
          if (deviceRequest.current === entry) deviceRequest.current = null;
        }
      })();
      return entry.promise;
    },
    [client, session],
  );

  const chooseProject = useCallback(
    (projectId: string | null) => {
      selectedRef.current = projectId;
      setSelectedProjectId(projectId);
      rememberProject(projectId);
      if (projectId !== null) void loadDevices(projectId);
    },
    [loadDevices],
  );

  const loadProjects = useCallback(async () => {
    const token = session.getToken();
    if (token === null) return;
    setProjectState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const items = await client.listProjects(token);
      if (session.getToken() !== token) return;
      setProjectState({ items, loading: false, error: null });
      // Keep the remembered project when it is still listed; a single project is chosen for the user.
      const remembered = selectedRef.current;
      if (remembered !== null && items.some((p) => p.id === remembered)) void loadDevices(remembered);
      else if (items.length === 1) chooseProject(items[0].id);
      else chooseProject(null);
    } catch (error) {
      if (session.getToken() !== token) return;
      setProjectState({ items: [], loading: false, error: asCloudError(error) });
    }
  }, [client, session, chooseProject, loadDevices]);

  /**
   * Sends the browser to plotune.net with a fresh PKCE challenge and state. Returns false when nothing was sent: the
   * verifier and state could not be kept for the return trip, or the browser refused to make the random values.
   */
  const redirectToPlotune = useCallback(
    async (prompt?: SignInPrompt): Promise<boolean> => {
      try {
        const pkce = await createPkce();
        const state = randomState();
        if (!savePending(sso.storage, { verifier: pkce.verifier, state })) return false;
        setRedirecting(true);
        sso.redirect(buildAuthorizeUrl({ challenge: pkce.challenge, state, prompt }));
        return true;
      } catch {
        return false;
      }
    },
    [sso],
  );

  const startSignIn = useCallback(
    async (prompt?: 'login') => {
      // plotune.net only returns to bridge.plotune.net. Elsewhere a redirect would strand the verifier on another origin,
      // so nothing is redirected and nothing is stored.
      if (!ssoSupported(sso)) {
        setSignInNotice(SIGN_IN_UNSUPPORTED_ORIGIN);
        return;
      }
      // The user asked to sign in: both the sign-out and the failure flags stop applying to this tab.
      clearSignedOutThisTab(sso.storage);
      clearSilentFailed(sso.storage);
      setSignInNotice(null);
      const started = await redirectToPlotune(prompt);
      if (!started) setSignInNotice(sso.storage === null ? SIGN_IN_NEEDS_STORAGE : SIGN_IN_NOT_COMPLETED);
    },
    [sso, redirectToPlotune],
  );

  /** Handles the fragment plotune.net sent back. The fragment has already been removed from the address bar. */
  const completeSignIn = useCallback(
    async (hash: string) => {
      const parsed = parseCallbackHash(hash);
      const pending = readPending(sso.storage);
      // The verifier and state are single-use: they leave storage now, whatever happens next.
      clearPending(sso.storage);
      // Every outcome other than a successful exchange stops the automatic attempt until the user chooses Sign in.
      // A stray fragment with nothing pending is not a failed sign-in, so it stays silent, but it still counts as a failure here.
      if (parsed === null && pending === null) {
        markSilentFailed(sso.storage);
        return;
      }
      if (parsed === null || pending === null || parsed.state !== pending.state) {
        markSilentFailed(sso.storage);
        setSignInNotice(SIGN_IN_NOT_COMPLETED);
        return;
      }
      if (parsed.kind === 'error') {
        markSilentFailed(sso.storage);
        // login_required is the expected answer to the automatic attempt: the user simply is not signed in there.
        if (parsed.error === 'access_denied') setSignInNotice(SIGN_IN_CANCELLED);
        else if (parsed.error !== 'login_required') setSignInNotice(SIGN_IN_NOT_COMPLETED);
        return;
      }
      const run = ++callbackRun.current;
      const current = () => run === callbackRun.current;
      setExchanging(true);
      try {
        const token = await client.exchangeBridgeCode(parsed.code, pending.verifier);
        // The user gave up on this attempt (the fallback): a late answer signs nobody in and shows nothing.
        if (!current()) return;
        session.setToken(token.accessToken, Math.floor(Date.now() / 1000) + token.expiresIn);
        if (session.getToken() === null) throw new CloudError('bad-response');
        setUsername(token.username);
        clearSignedOutThisTab(sso.storage);
        clearSilentFailed(sso.storage);
        setSignInNotice(null);
        // The callback's loading state ends with the token; the project list loads in the signed-in workspace.
        setExchanging(false);
        void loadProjects();
      } catch (error) {
        if (!current()) return;
        markSilentFailed(sso.storage);
        setSignInNotice(error instanceof CloudError && error.code === 'sign-in-expired' ? SIGN_IN_EXPIRED : SIGN_IN_NOT_COMPLETED);
      } finally {
        if (current()) setExchanging(false);
      }
    },
    [client, session, sso, loadProjects],
  );

  // Once per page load. A returning fragment is completed. Otherwise, with no session in memory, a browser that keeps
  // session storage, no sign-out in this tab and no failed attempt, an automatic (prompt=none) attempt runs on every load.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    // Off the supported origin the plan is 'none' and nothing here reads or writes storage.
    if (boot.plan === 'callback') {
      sso.clearHash();
      // The fragment is already gone; the completion (which updates state) runs as a separate task, after this effect.
      queueMicrotask(() => void completeSignIn(boot.hash).finally(() => setBootPending(false)));
      return;
    }
    if (boot.plan === 'stale') {
      // Retrying a pair that never came back would not come back either, so it counts as a failure and nothing is redirected.
      clearPending(sso.storage);
      markSilentFailed(sso.storage);
      return;
    }
    if (boot.plan === 'auto') {
      queueMicrotask(() => void redirectToPlotune('none').then((started) => {
        if (!started) markSilentFailed(sso.storage);
        setBootPending(false);
      }));
    }
  }, [sso, boot, completeSignIn, redirectToPlotune]);

  // A page restored from the back/forward cache may still show "signing in" from a redirect that was abandoned.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const signOut = useCallback(() => {
    session.clear();
    markSignedOutThisTab(sso.storage);
    setUsername(null);
    setSignInNotice(null);
    setProjectState({ items: [], loading: false, error: null });
    deviceRequest.current = null;
    setDeviceState({ items: [], loading: false, error: null, projectId: null, loaded: false });
  }, [session, sso]);

  const continueWithoutSignIn = useCallback(() => {
    // The attempt is abandoned: a late exchange answer is ignored, a pair that comes back later is a mismatch, and no
    // automatic attempt runs in this tab until the user chooses Sign in.
    callbackRun.current += 1;
    clearPending(sso.storage);
    markSilentFailed(sso.storage);
    setRedirecting(false);
    setExchanging(false);
    setBootPending(false);
  }, [sso]);

  // Every change of the account session (sign-in, sign-out, a replaced token) moves this on, so a queued job can tell
  // that the session it was started for is gone.
  const readSessionGeneration = useCallback(() => sessionGeneration.current, []);
  useEffect(() => session.subscribe(() => {
    sessionGeneration.current += 1;
  }), [session]);

  const dismissSignInNotice = useCallback(() => setSignInNotice(null), []);

  const refreshDevices = useCallback(async () => {
    const projectId = selectedRef.current;
    if (projectId !== null) await loadDevices(projectId);
  }, [loadDevices]);

  const createPairingCode = useCallback(async () => {
    const token = session.getToken();
    const projectId = selectedRef.current;
    if (token === null) throw new CloudError('unauthorized');
    if (projectId === null) throw new CloudError('invalid-request');
    return client.createPairingToken(token, projectId);
  }, [client, session]);

  const selectProject = useCallback((projectId: string) => chooseProject(projectId), [chooseProject]);

  const status: CloudStatus = redirecting || exchanging || bootPending ? 'signing-in' : signedIn ? 'signed-in' : 'signed-out';
  const signInAvailable = ssoSupported(sso);
  const value = useMemo<CloudContextValue>(
    () => ({
      status,
      username: signedIn ? username : null,
      signInNotice,
      dismissSignInNotice,
      startSignIn,
      signOut,
      signInAvailable,
      sessionGeneration: readSessionGeneration,
      continueWithoutSignIn,
      projects: signedIn ? projectState.items : [],
      projectsLoading: signedIn && projectState.loading,
      projectsError: signedIn ? projectState.error : null,
      selectedProjectId,
      selectProject,
      devices: signedIn && deviceState.projectId === selectedProjectId ? deviceState.items : [],
      devicesLoading: signedIn && deviceState.projectId === selectedProjectId && deviceState.loading,
      devicesLoaded: signedIn && deviceState.projectId === selectedProjectId && deviceState.loaded,
      devicesError: signedIn && deviceState.projectId === selectedProjectId ? deviceState.error : null,
      refreshDevices,
      createPairingCode,
    }),
    [status, username, signInNotice, dismissSignInNotice, startSignIn, signOut, signInAvailable, readSessionGeneration, continueWithoutSignIn, signedIn, projectState, selectedProjectId, selectProject, deviceState, refreshDevices, createPairingCode],
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

export function useCloud(): CloudContextValue {
  const value = useContext(CloudContext);
  if (!value) throw new Error('CloudProvider is missing');
  return value;
}
