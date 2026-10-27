import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { DeviceHub, HubState } from './hub';
import type { WorkspaceState, WorkspaceStore } from './store';

const StoreContext = createContext<WorkspaceStore | null>(null);
const HubContext = createContext<DeviceHub | null>(null);

/** Provides one device's store to the panels below it. They always act on that device. */
export function StoreProvider({ store, children }: { store: WorkspaceStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function HubProvider({ hub, children }: { hub: DeviceHub; children: ReactNode }) {
  return <HubContext.Provider value={hub}>{children}</HubContext.Provider>;
}

export function useStore(): WorkspaceStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreProvider is missing');
  return store;
}

export function useWorkspace(): WorkspaceState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}

export function useHub(): DeviceHub {
  const hub = useContext(HubContext);
  if (!hub) throw new Error('HubProvider is missing');
  return hub;
}

export function useHubState(): HubState {
  const hub = useHub();
  return useSyncExternalStore(hub.subscribe, hub.getState);
}
