// A workspace that already has a few canvases, for tests that need panels to be there. A first visit is one blank canvas.
import { ProjectStore, PROJECTS_KEY, type StoragePort } from '../../src/workspace/project';

export function memoryStorage(initial: Record<string, string> = {}): StoragePort & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

/** Writes three canvases into `storage` (Capture, Diagnostics, Analysis) and returns a store that reads them. */
export function seededProject(storage: StoragePort & { data: Record<string, string> } = memoryStorage()): ProjectStore {
  const seed = memoryStorage();
  const s = new ProjectStore(() => seed);
  const first = s.getState().project.canvases[0]!.id;
  s.renameCanvas(first, 'Capture');
  s.applyTemplate(first, 'capture');
  s.addCanvas('Diagnostics', 'diagnostics');
  s.addCanvas('Analysis', 'analysis');
  s.setActive(first);
  storage.data[PROJECTS_KEY] = seed.data[PROJECTS_KEY]!;
  return new ProjectStore(() => storage);
}
