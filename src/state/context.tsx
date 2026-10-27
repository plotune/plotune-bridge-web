import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { WorkspaceState, WorkspaceStore } from './store';

const StoreContext = createContext<WorkspaceStore | null>(null);

export function StoreProvider({ store, children }: { store: WorkspaceStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
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
