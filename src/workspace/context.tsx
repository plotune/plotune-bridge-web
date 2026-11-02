import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { Canvas } from './project';
import type { ProjectState, ProjectStore } from './project';

const Ctx = createContext<ProjectStore | null>(null);

export function ProjectProvider({ store, children }: { store: ProjectStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
export function useProjectStore(): ProjectStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('ProjectProvider is missing');
  return s;
}
export function useProject(): ProjectState {
  const s = useProjectStore();
  return useSyncExternalStore(s.subscribe, s.getState);
}
export function useActiveCanvas(): Canvas {
  const { project } = useProject();
  return project.canvases.find((c) => c.id === project.active) ?? project.canvases[0]!;
}

/** True inside a dock group: the group's tab strip already shows the title and the maximize button. */
export const DockedContext = createContext(false);
export const useDocked = (): boolean => useContext(DockedContext);

/** The DOM id of the panel being rendered. The first panel of a type keeps the id it always had (#panel-trace). */
export const PanelDomIdContext = createContext<string | null>(null);

/** Opens the settings dialog of a device (the selected one when no id is given). Provided by the app shell. */
export const OpenSettingsContext = createContext<(deviceId?: string) => void>(() => undefined);
export const useOpenSettings = (): ((deviceId?: string) => void) => useContext(OpenSettingsContext);
