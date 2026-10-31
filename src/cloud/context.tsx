// React access to the Plotune account: sign-in, the project list, the selected project and its devices.
// The account token lives only in the session (memory). The only thing written to storage is the selected project ID.
import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { readStored, removeStored, writeStored } from '../lib/storage';
import { createCloudClient, CloudError, type CloudClient, type CloudDevice, type CloudProject, type PairingToken } from './client';
import { cloudSession, type CloudSession } from './session';

export const SELECTED_PROJECT_KEY = 'bw.cloud.project';
const MAX_ID_LENGTH = 128;

export type CloudStatus = 'signed-out' | 'signing-in' | 'signed-in';

export interface CloudContextValue {
  status: CloudStatus;
  /** Rejects with CloudError. The password is passed on and never kept. */
  signIn(usernameOrEmail: string, password: string): Promise<void>;
  signOut(): void;
  projects: CloudProject[];
  projectsLoading: boolean;
  projectsError: CloudError | null;
  selectedProjectId: string | null;
  selectProject(projectId: string): void;
  /** Devices of the selected project only. Empty while none is selected. */
  devices: CloudDevice[];
  devicesLoading: boolean;
  devicesError: CloudError | null;
  refreshDevices(): Promise<void>;
  /** Rejects with CloudError. The code is returned to the caller only; it is never stored. */
  createPairingCode(): Promise<PairingToken>;
}

const CloudContext = createContext<CloudContextValue | null>(null);
const defaultClient: CloudClient = createCloudClient();

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

export interface CloudProviderProps {
  children: ReactNode;
  /** Injected by tests; the app uses the real client and the app-wide session. */
  client?: CloudClient;
  session?: CloudSession;
}

export function CloudProvider({ children, client = defaultClient, session = cloudSession }: CloudProviderProps) {
  // The token is read from the session on every render; subscribing keeps the status current when it expires or is cleared.
  const signedIn = useSyncExternalStore(session.subscribe, () => session.getToken() !== null);
  const [signingIn, setSigningIn] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(readSelectedProject);
  const [projectState, setProjectState] = useState<ListState<CloudProject>>({ items: [], loading: false, error: null });
  const [deviceState, setDeviceState] = useState<ListState<CloudDevice> & { projectId: string | null }>({ items: [], loading: false, error: null, projectId: null });
  // Read by the async loaders when a response arrives, so a late answer for an old project or session is dropped.
  const selectedRef = useRef<string | null>(selectedProjectId);
  const deviceEpoch = useRef(0);

  const loadDevices = useCallback(
    async (projectId: string) => {
      const token = session.getToken();
      if (token === null) return;
      const epoch = ++deviceEpoch.current;
      setDeviceState((prev) => ({ projectId, items: prev.projectId === projectId ? prev.items : [], loading: true, error: null }));
      try {
        const items = await client.listDevices(token, projectId);
        if (epoch !== deviceEpoch.current || session.getToken() !== token) return;
        setDeviceState({ projectId, items, loading: false, error: null });
      } catch (error) {
        if (epoch !== deviceEpoch.current || session.getToken() !== token) return;
        setDeviceState({ projectId, items: [], loading: false, error: asCloudError(error) });
      }
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

  const signIn = useCallback(
    async (usernameOrEmail: string, password: string) => {
      setSigningIn(true);
      try {
        const { accessToken } = await client.login(usernameOrEmail, password);
        session.setToken(accessToken);
        if (session.getToken() === null) throw new CloudError('bad-response');
        await loadProjects();
      } finally {
        setSigningIn(false);
      }
    },
    [client, session, loadProjects],
  );

  const signOut = useCallback(() => {
    session.clear();
    setProjectState({ items: [], loading: false, error: null });
    setDeviceState({ items: [], loading: false, error: null, projectId: null });
  }, [session]);

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

  const status: CloudStatus = signingIn ? 'signing-in' : signedIn ? 'signed-in' : 'signed-out';
  const value = useMemo<CloudContextValue>(
    () => ({
      status,
      signIn,
      signOut,
      projects: signedIn ? projectState.items : [],
      projectsLoading: signedIn && projectState.loading,
      projectsError: signedIn ? projectState.error : null,
      selectedProjectId,
      selectProject,
      devices: signedIn && deviceState.projectId === selectedProjectId ? deviceState.items : [],
      devicesLoading: signedIn && deviceState.projectId === selectedProjectId && deviceState.loading,
      devicesError: signedIn && deviceState.projectId === selectedProjectId ? deviceState.error : null,
      refreshDevices,
      createPairingCode,
    }),
    [status, signIn, signOut, signedIn, projectState, selectedProjectId, selectProject, deviceState, refreshDevices, createPairingCode],
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

export function useCloud(): CloudContextValue {
  const value = useContext(CloudContext);
  if (!value) throw new Error('CloudProvider is missing');
  return value;
}
