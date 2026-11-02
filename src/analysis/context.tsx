import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useProjectStore } from '../workspace/context';
import { panelsIn, type LayoutNode } from '../workspace/layout';
import { addSignals, emptyConfig } from './model';
import type { Recording } from './math';

/** Recordings made or opened in this page. They are not saved: close the page and they are gone (export CSV to keep one). */
export class RecordingStore {
  private recs: Recording[] = [];
  private readonly listeners = new Set<() => void>();
  getSnapshot = (): readonly Recording[] => this.recs;
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  private set(next: Recording[]): void { this.recs = next; this.listeners.forEach((l) => l()); }
  add(r: Recording): void { this.set([r, ...this.recs].slice(0, 30)); }
  remove(id: string): void { this.set(this.recs.filter((r) => r.id !== id)); }
  rename(id: string, name: string): void { this.set(this.recs.map((r) => (r.id === id ? { ...r, name: name.trim().slice(0, 48) || r.name } : r))); }
  get(id: string | undefined): Recording | undefined { return id ? this.recs.find((r) => r.id === id) : undefined; }
}

interface AnalysisApi { store: RecordingStore; open(rec: Recording, keys?: readonly string[]): void }
const Ctx = createContext<AnalysisApi | null>(null);

export function AnalysisProvider({ store: given, children }: { store?: RecordingStore; children: ReactNode }) {
  const [store] = useState(() => given ?? new RecordingStore());
  const project = useProjectStore();
  const open = useCallback((rec: Recording, keys?: readonly string[]) => {
    const st = project.getState().project;
    const canvas = st.canvases.find((c) => c.id === st.active);
    if (!canvas) return;
    let pid = panelsIn(canvas.root).find((id) => st.panels[id]?.type === 'analyzer');
    if (!pid) pid = project.addPanel('analyzer') ?? undefined;
    if (!pid) return;
    const chosen = keys ?? Object.keys(rec.signals).slice(0, 4);
    project.setPanelConfig(pid, addSignals(emptyConfig(rec.id), rec, chosen, 'new', 'unit') as unknown as Record<string, unknown>);
    const live = project.getState().project;
    const group = live.canvases.find((c) => c.id === live.active)?.root;
    if (group) {
      const g = findTabGroup(group, pid);
      if (g) project.setActiveTab(g, pid);
    }
  }, [project]);
  const api = useMemo(() => ({ store, open }), [store, open]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

function findTabGroup(n: LayoutNode, pid: string): string | null {
  if (n.kind === 'group') return n.tabs.includes(pid) ? n.id : null;
  for (const c of n.children) { const r = findTabGroup(c, pid); if (r) return r; }
  return null;
}

/** The analysis tools, or null where there are none (a panel shown on its own). */
export const useAnalysisMaybe = (): AnalysisApi | null => useContext(Ctx);
export function useAnalysis(): AnalysisApi {
  const a = useContext(Ctx);
  if (!a) throw new Error('AnalysisProvider is missing');
  return a;
}
export function useRecordings(): readonly Recording[] {
  const { store } = useAnalysis();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
