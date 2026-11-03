import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { startFile } from './OpenFile';
import { useProjectStore } from '../workspace/context';
import { panelsIn, type LayoutNode } from '../workspace/layout';
import { addSignals, emptyConfig } from './model';
import type { Recording, SignalData } from './math';
import type { CanLog } from '../logs/read';
import { OpenFileFlow, type FileFlow } from './OpenFile';

/** Recordings made or opened in this page. They are not saved: close the page and they are gone (export CSV to keep one). */
export class RecordingStore {
  private recs: Recording[] = [];
  private readonly listeners = new Set<() => void>();
  /** The frames of opened logs, by recording id. Their signals are decoded from these when they are added to a plot. */
  readonly logs = new Map<string, { log: CanLog; present: Set<string> }>();
  getSnapshot = (): readonly Recording[] => this.recs;
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  private set(next: Recording[]): void { this.recs = next; this.listeners.forEach((l) => l()); }
  add(r: Recording): void { this.set([r, ...this.recs].slice(0, 30)); }
  remove(id: string): void { this.logs.delete(id); this.set(this.recs.filter((r) => r.id !== id)); }
  /** Adds decoded signals to a recording, so a plot can show them. */
  addSignals(id: string, signals: readonly SignalData[]): Recording | undefined {
    const r = this.recs.find((x) => x.id === id);
    if (!r) return undefined;
    const next = { ...r, signals: { ...r.signals, ...Object.fromEntries(signals.map((s) => [s.key, s])) } };
    this.set(this.recs.map((x) => (x.id === id ? next : x)));
    return next;
  }
  rename(id: string, name: string): void { this.set(this.recs.map((r) => (r.id === id ? { ...r, name: name.trim().slice(0, 48) || r.name } : r))); }
  get(id: string | undefined): Recording | undefined { return id ? this.recs.find((r) => r.id === id) : undefined; }
}

interface AnalysisApi {
  store: RecordingStore;
  open(rec: Recording, keys?: readonly string[]): void;
  /** Asks for a file (CSV, ASC, BLF, candump) and opens it. Logs of frames ask which database each channel uses first. */
  pickFile(): void;
  /** Opens a file already in hand. Resolves to a message when it cannot be opened. */
  openFile(file: File): Promise<string | null>;
  /** The settings of an opened log: which database each channel uses. */
  logSettings(recordingId: string): void;
}
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
  const [flow, setFlow] = useState<FileFlow | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const openFile = useCallback((file: File) => startFile(file, store, open, setFlow), [store, open]);
  const api = useMemo(() => ({ store, open, pickFile: () => input.current?.click(), openFile, logSettings: (id: string) => setFlow({ kind: 'settings', recordingId: id }) }), [store, open, openFile]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <input ref={input} type="file" hidden aria-hidden="true" tabIndex={-1} data-testid="open-file" accept=".csv,.asc,.blf,.log,.txt,text/csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openFile(f).then((m) => { if (m) setFlow({ kind: 'error', message: m }); }); }} />
      {flow && <OpenFileFlow flow={flow} store={store} open={open} onClose={() => setFlow(null)} />}
    </Ctx.Provider>
  );
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
