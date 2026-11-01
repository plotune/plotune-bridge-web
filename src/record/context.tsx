import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { RecordingService } from './recorder';

const fallback = new RecordingService();
const RecordingContext = createContext<RecordingService>(fallback);

export function RecordingProvider({ service, children }: { service: RecordingService; children: ReactNode }) {
  return <RecordingContext.Provider value={service}>{children}</RecordingContext.Provider>;
}

/** The recording service; re-renders when a recording starts or stops. */
export function useRecording(): RecordingService {
  const service = useContext(RecordingContext);
  useSyncExternalStore(service.subscribe, service.getVersion);
  return service;
}
