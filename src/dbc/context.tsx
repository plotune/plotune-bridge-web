import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { DbcRegistry, type DbcAssignment } from './registry';

const fallback = new DbcRegistry(null);
const DbcContext = createContext<DbcRegistry>(fallback);

export function DbcProvider({ registry, children }: { registry: DbcRegistry; children: ReactNode }) {
  return <DbcContext.Provider value={registry}>{children}</DbcContext.Provider>;
}

export function useDbcRegistry(): DbcRegistry {
  return useContext(DbcContext);
}

/** Re-renders when a database is loaded or removed. */
export function useDbcAssignments(): readonly DbcAssignment[] {
  const registry = useDbcRegistry();
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot);
}
