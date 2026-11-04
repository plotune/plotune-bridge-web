import { parseReferences, type DatabaseReference } from '../dbc/references';
// A saved workspace (called a Project in the code): named canvases, each a dock layout of panels, and the panels' settings. It is
// browser-owned convenience state: it never holds device addresses, tokens or captured data. It is not the Plotune account project
// that devices are paired to; saving a workspace into that project is the V2.5 step (see docs/workspace-v2.md).
import { autoPlace, group, groupById, insertPanel, movePanel as moveInTree, newId, normalize, panelsIn, parseLayout, remap, removePanel, resizeSplit, setActiveTab, split, type DropZone, type LayoutNode } from './layout';

export const PROJECT_VERSION = 2;
export const PROJECTS_KEY = 'bw.projects';
export const MAX_CANVASES = 24;
export const MAX_PANELS = 120;
export const MAX_PROJECTS = 20;
export const MAX_NAME = 48;
/** How much room a panel type wants, relative to the others, when it is added beside or under one. */
const WEIGHT: Record<PanelType, number> = { trace: 3, plot: 3, analyzer: 3, recordings: 1.5, uds: 2, xcp: 2, transmit: 1.5, stats: 1 };

// Settings of one device (channels, the device itself, the diagnostic link) are not panels: they live in that device's settings
// dialog, so two Bridges never share a panel that can only show one of them. An older saved workspace that still names those
// panel types loses them when it is read.
export const PANEL_TYPES = ['trace', 'plot', 'stats', 'transmit', 'uds', 'xcp', 'analyzer', 'recordings'] as const;
export type PanelType = (typeof PANEL_TYPES)[number];
export const isPanelType = (v: unknown): v is PanelType => PANEL_TYPES.includes(v as PanelType);

export interface PanelInstance {
  type: PanelType;
  /** A name the user gave this panel. Shown instead of the type's title. */
  name?: string;
  /** The device this panel reads from: a device id, or absent for "the selected device". */
  device?: string;
  /** Settings owned by the panel type (the Analyzer keeps its strips and axes here). Validated by that type. */
  config?: Record<string, unknown>;
}
export interface Canvas {
  id: string;
  name: string;
  root: LayoutNode | null;
}
export interface Project {
  databaseReferences?: DatabaseReference[];
  version: typeof PROJECT_VERSION;
  id: string;
  name: string;
  active: string;
  canvases: Canvas[];
  panels: Record<string, PanelInstance>;
}
export interface SavedProject extends Project { updated: number }
export type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const idLike = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);
export const cleanName = (v: unknown, fallback: string): string => {
  const s = typeof v === 'string' ? [...v].map((ch) => (ch < ' ' ? ' ' : ch)).join('').trim().slice(0, MAX_NAME) : '';
  return s || fallback;
};

/* ───────────── templates ───────────── */
export interface Template { id: string; label: string; description: string }
export const TEMPLATES: readonly Template[] = [
  { id: 'capture', label: 'Capture', description: 'Trace and scope, with statistics and a frame composer.' },
  { id: 'debug', label: 'Debug a signal', description: 'A large scope with its trace beside it.' },
  { id: 'transmit', label: 'Transmit and test', description: 'Compose frames and watch the bus.' },
  { id: 'diagnostics', label: 'Diagnostics', description: 'UDS requests and XCP calibration.' },
  { id: 'analysis', label: 'Analysis', description: 'Recordings and an Analyzer for recorded data.' },
];

interface Built { root: LayoutNode | null; panels: Record<string, PanelInstance> }
export function buildTemplate(id: string): Built {
  const panels: Record<string, PanelInstance> = {};
  const mk = (type: PanelType, extra: Partial<PanelInstance> = {}): string => {
    const pid = newId('p');
    panels[pid] = { type, ...extra };
    return pid;
  };
  const g = (...ids: string[]) => group(ids);
  switch (id) {
    case 'capture':
      return { panels, root: split('col', [split('row', [g(mk('trace')), g(mk('plot'))], [0.6, 0.4]), split('row', [g(mk('stats')), g(mk('transmit'))], [0.3, 0.7])], [0.64, 0.36]) };
    case 'debug':
      return { panels, root: split('row', [g(mk('plot')), g(mk('trace'))], [0.62, 0.38]) };
    case 'transmit':
      return { panels, root: split('row', [g(mk('transmit')), split('col', [g(mk('trace')), g(mk('stats'))], [0.7, 0.3])], [0.45, 0.55]) };
    case 'diagnostics':
      return { panels, root: split('row', [g(mk('uds')), g(mk('xcp'))], [0.5, 0.5]) };
    case 'analysis':
      return { panels, root: split('row', [g(mk('analyzer')), g(mk('recordings'))], [0.72, 0.28]) };
    default:
      return { panels, root: null };
  }
}

/** A first visit: one blank canvas. Nothing is laid out for the user; the empty canvas offers a few starting points. */
export function defaultProject(name = 'My workspace'): Project {
  const canvas: Canvas = { id: newId('c'), name: 'Canvas 1', root: null };
  return { version: PROJECT_VERSION, id: newId('pr'), name, active: canvas.id, canvases: [canvas], panels: {} };
}

/* ───────────── reading and writing ───────────── */
function parsePanel(v: unknown): PanelInstance | null {
  if (!record(v) || !isPanelType(v.type)) return null;
  const p: PanelInstance = { type: v.type };
  if (typeof v.name === 'string' && v.name.trim()) p.name = cleanName(v.name, '');
  if (idLike(v.device)) p.device = v.device;
  if (record(v.config) && JSON.stringify(v.config).length <= 100_000) p.config = v.config;
  return p;
}

/** Reads a project from storage or an imported file. Returns null when the file is not a project at all. */
export function parseProject(input: unknown): Project | null {
  if (!record(input) || input.version !== PROJECT_VERSION || !Array.isArray(input.canvases) || !record(input.panels)) return null;
  const references = input.databaseReferences === undefined ? undefined : parseReferences(input.databaseReferences);
  if (references === null) return null;
  const panels: Record<string, PanelInstance> = {};
  for (const [pid, raw] of Object.entries(input.panels)) {
    if (!idLike(pid) || Object.keys(panels).length >= MAX_PANELS) continue;
    const p = parsePanel(raw);
    if (p) panels[pid] = p;
  }
  const known = new Set(Object.keys(panels));
  const used = new Set<string>();
  const canvases: Canvas[] = [];
  const ids = new Set<string>();
  for (const c of input.canvases.slice(0, MAX_CANVASES)) {
    if (!record(c)) continue;
    const root = parseLayout(c.root, new Set([...known].filter((k) => !used.has(k))));
    panelsIn(root).forEach((p) => used.add(p));
    let id = idLike(c.id) && !ids.has(c.id) ? c.id : newId('c');
    while (ids.has(id)) id = newId('c');
    ids.add(id);
    canvases.push({ id, name: cleanName(c.name, `Canvas ${canvases.length + 1}`), root });
  }
  if (canvases.length === 0) return null;
  for (const pid of Object.keys(panels)) if (!used.has(pid)) delete panels[pid];
  const active = typeof input.active === 'string' && ids.has(input.active) ? input.active : canvases[0]!.id;
  return { version: PROJECT_VERSION, id: idLike(input.id) ? input.id : newId('pr'), name: cleanName(input.name, 'Imported project'), active, canvases, panels, ...(references ? { databaseReferences: references } : {}) };
}

export interface ProjectState {
  project: Project;
  /** Every project saved in this browser, newest first. */
  projects: { id: string; name: string; updated: number; canvases: string[] }[];
  /** The canvas last deleted, for Undo. */
  deleted: { canvas: Canvas; panels: Record<string, PanelInstance>; index: number } | null;
  /** Set when saving failed (storage full or blocked). The project still works in memory. */
  saveFailed: boolean;
}

export class ProjectStore {
  private state: ProjectState;
  private saved: SavedProject[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: () => StoragePort | null = () => localStorage, private readonly now: () => number = Date.now) {
    let currentId = '';
    try {
      const raw = storage()?.getItem(PROJECTS_KEY);
      if (raw != null) {
        const data: unknown = JSON.parse(raw);
        if (record(data) && data.version === PROJECT_VERSION && Array.isArray(data.projects)) {
          for (const p of data.projects.slice(0, MAX_PROJECTS)) {
            const parsed = parseProject(p);
            if (parsed) this.saved.push({ ...parsed, updated: record(p) && typeof p.updated === 'number' ? p.updated : 0 });
          }
          currentId = typeof data.current === 'string' ? data.current : '';
        }
      }
    } catch { /* unavailable or corrupt: start with the default project */ }
    const current = this.saved.find((p) => p.id === currentId) ?? this.saved[0] ?? null;
    const project = current ? { ...current } : defaultProject();
    this.state = { project, projects: [], deleted: null, saveFailed: false };
    this.commit(project, false, {}, false);
  }

  getState = (): ProjectState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private commit(project: Project, touch = true, extra: Partial<ProjectState> = {}, persist = true): void {
    const entry: SavedProject = { ...project, updated: touch ? this.now() : (this.saved.find((p) => p.id === project.id)?.updated ?? this.now()) };
    this.saved = [entry, ...this.saved.filter((p) => p.id !== project.id)].slice(0, MAX_PROJECTS).sort((a, b) => b.updated - a.updated);
    let saveFailed = false;
    // Opening the page writes nothing: the first change is what saves.
    if (persist) {
      try {
        this.storage()?.setItem(PROJECTS_KEY, JSON.stringify({ version: PROJECT_VERSION, current: project.id, projects: this.saved }));
      } catch { saveFailed = true; }
    }
    const projects = this.saved.map((p) => ({ id: p.id, name: p.name, updated: p.updated, canvases: p.canvases.map((c) => c.name) }));
    this.state = { ...this.state, ...extra, project, projects, saveFailed };
    this.listeners.forEach((l) => l());
  }

  private get project(): Project { return this.state.project; }
  private canvas(id = this.project.active): Canvas | undefined { return this.project.canvases.find((c) => c.id === id); }
  private patchCanvas(id: string, fn: (c: Canvas) => Canvas): void {
    this.commit({ ...this.project, canvases: this.project.canvases.map((c) => (c.id === id ? fn(c) : c)) });
  }
  private prune(project: Project): Project {
    const used = new Set(project.canvases.flatMap((c) => panelsIn(c.root)));
    return { ...project, panels: Object.fromEntries(Object.entries(project.panels).filter(([id]) => used.has(id))) };
  }

  /* ---- project ---- */
  renameProject(name: string): void { this.commit({ ...this.project, name: cleanName(name, this.project.name) }); }
  newProject(name = 'Untitled project'): void {
    const blank = buildTemplate('');
    const canvas: Canvas = { id: newId('c'), name: 'Canvas 1', root: blank.root };
    this.commit({ version: PROJECT_VERSION, id: newId('pr'), name: cleanName(name, 'Untitled project'), active: canvas.id, canvases: [canvas], panels: {} }, true, { deleted: null });
  }
  openProject(id: string): boolean {
    const p = this.saved.find((s) => s.id === id);
    if (!p) return false;
    this.commit({ ...p }, false, { deleted: null });
    return true;
  }
  duplicateProject(name?: string): void {
    const rename = new Map<string, string>();
    const panels: Record<string, PanelInstance> = {};
    for (const [id, p] of Object.entries(this.project.panels)) { const nid = newId('p'); rename.set(id, nid); panels[nid] = structuredClone(p); }
    const canvases = this.project.canvases.map((c) => ({ id: newId('c'), name: c.name, root: remap(c.root, (p) => rename.get(p) ?? p) }));
    const active = canvases[this.project.canvases.findIndex((c) => c.id === this.project.active)]?.id ?? canvases[0]!.id;
    this.commit({ ...this.project, version: PROJECT_VERSION, id: newId('pr'), name: cleanName(name, `${this.project.name} copy`), active, canvases, panels }, true, { deleted: null });
  }
  deleteProject(id: string): void {
    if (id === this.project.id) return;
    this.saved = this.saved.filter((p) => p.id !== id);
    this.commit(this.project, false);
  }
  exportJson(): string { return JSON.stringify(this.project, null, 1); }
  /** Imports a project file as a new project. Returns the reason when it cannot. */
  importJson(text: string): { ok: true; name: string } | { ok: false; reason: string } {
    if (text.length > 2_000_000) return { ok: false, reason: 'That file is too large to be a workspace.' };
    let data: unknown;
    try { data = JSON.parse(text); } catch { return { ok: false, reason: 'That is not a workspace file.' }; }
    const parsed = parseProject(data);
    if (!parsed) return { ok: false, reason: 'That file is not a Plotune Bridge workspace, or it is from a newer version.' };
    this.commit({ ...parsed, id: newId('pr') }, true, { deleted: null });
    return { ok: true, name: parsed.name };
  }

  /* ---- canvases ---- */
  setActive(id: string): void {
    if (id === this.project.active || !this.canvas(id)) return;
    this.commit({ ...this.project, active: id }, false);
  }
  addCanvas(name: string, template = ''): string | null {
    if (this.project.canvases.length >= MAX_CANVASES) return null;
    const b = buildTemplate(template);
    const canvas: Canvas = { id: newId('c'), name: cleanName(name, `Canvas ${this.project.canvases.length + 1}`), root: b.root };
    this.commit({ ...this.project, canvases: [...this.project.canvases, canvas], panels: { ...this.project.panels, ...b.panels }, active: canvas.id });
    return canvas.id;
  }
  /** Fills an empty canvas from a template. */
  applyTemplate(id: string, template: string): void {
    const c = this.canvas(id);
    if (!c || c.root) return;
    const b = buildTemplate(template);
    this.commit({ ...this.project, canvases: this.project.canvases.map((x) => (x.id === id ? { ...x, root: b.root } : x)), panels: { ...this.project.panels, ...b.panels } });
  }
  renameCanvas(id: string, name: string): void { this.patchCanvas(id, (c) => ({ ...c, name: cleanName(name, c.name) })); }
  duplicateCanvas(id: string, name?: string): string | null {
    const src = this.canvas(id);
    if (!src || this.project.canvases.length >= MAX_CANVASES) return null;
    const rename = new Map<string, string>();
    const panels = { ...this.project.panels };
    for (const pid of panelsIn(src.root)) { const nid = newId('p'); rename.set(pid, nid); panels[nid] = structuredClone(this.project.panels[pid]!); }
    const copy: Canvas = { id: newId('c'), name: cleanName(name, `${src.name} copy`), root: remap(src.root, (p) => rename.get(p) ?? p) };
    const i = this.project.canvases.findIndex((c) => c.id === id);
    const canvases = this.project.canvases.slice();
    canvases.splice(i + 1, 0, copy);
    this.commit({ ...this.project, canvases, panels, active: copy.id });
    return copy.id;
  }
  deleteCanvas(id: string): boolean {
    if (this.project.canvases.length < 2) return false;
    const index = this.project.canvases.findIndex((c) => c.id === id);
    const canvas = this.project.canvases[index];
    if (!canvas) return false;
    const panels = Object.fromEntries(panelsIn(canvas.root).map((p) => [p, this.project.panels[p]!]));
    const canvases = this.project.canvases.filter((c) => c.id !== id);
    const active = this.project.active === id ? canvases[Math.max(0, index - 1)]!.id : this.project.active;
    this.commit(this.prune({ ...this.project, canvases, active }), true, { deleted: { canvas, panels, index } });
    return true;
  }
  undoDeleteCanvas(): void {
    const d = this.state.deleted;
    if (!d) return;
    const canvases = this.project.canvases.slice();
    canvases.splice(Math.min(d.index, canvases.length), 0, d.canvas);
    this.commit({ ...this.project, canvases, panels: { ...this.project.panels, ...d.panels }, active: d.canvas.id }, true, { deleted: null });
  }
  moveCanvas(id: string, delta: -1 | 1): void {
    const i = this.project.canvases.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.project.canvases.length) return;
    const canvases = this.project.canvases.slice();
    [canvases[i], canvases[j]] = [canvases[j]!, canvases[i]!];
    this.commit({ ...this.project, canvases });
  }

  /* ---- panels and layout of the active canvas ---- */
  addPanel(type: PanelType, groupId?: string, init: Partial<PanelInstance> = {}): string | null {
    const c = this.canvas();
    if (!c || Object.keys(this.project.panels).length >= MAX_PANELS || panelsIn(c.root).length >= 40) return null;
    const pid = newId('p');
    const target = (groupId && groupById(c.root, groupId)) || null;
    // Named group: a tab in it. Otherwise the panel is tiled into the canvas, beside or under the group with the most room.
    const place = target ? { groupId: target.id, zone: 'center' as const } : autoPlace(c.root);
    // A panel with little to show (counters, a form) gets less room than a table or a plot.
    const targetGroup = place ? groupById(c.root, place.groupId) : null;
    const targetType = targetGroup ? this.project.panels[targetGroup.active]?.type : undefined;
    const share = place?.zone === 'center' || !targetType ? 0.5 : WEIGHT[type] / (WEIGHT[type] + WEIGHT[targetType]);
    const root = c.root && place ? insertPanel(c.root, place.groupId, place.zone, pid, share) : group([pid]);
    this.commit({ ...this.project, canvases: this.project.canvases.map((x) => (x.id === c.id ? { ...x, root } : x)), panels: { ...this.project.panels, [pid]: { type, ...init } } });
    return pid;
  }
  closePanel(panelId: string): void {
    const c = this.canvas();
    if (!c) return;
    this.commit(this.prune({ ...this.project, canvases: this.project.canvases.map((x) => (x.id === c.id ? { ...x, root: normalize(removePanel(x.root, panelId)) } : x)) }));
  }
  movePanel(panelId: string, groupId: string, zone: DropZone): void { this.patchCanvas(this.project.active, (c) => ({ ...c, root: moveInTree(c.root, panelId, groupId, zone) })); }
  setActiveTab(groupId: string, panelId: string): void {
    const c = this.canvas();
    if (!c) return;
    this.commit({ ...this.project, canvases: this.project.canvases.map((x) => (x.id === c.id ? { ...x, root: setActiveTab(x.root, groupId, panelId) } : x)) }, false);
  }
  resize(splitId: string, index: number, delta: number): void { this.patchCanvas(this.project.active, (c) => ({ ...c, root: resizeSplit(c.root, splitId, index, delta) })); }
  /** Sets the shares of a split directly (a finished drag of its divider). */
  setSizes(splitId: string, sizes: number[]): void {
    const walk = (n: LayoutNode | null): LayoutNode | null => {
      if (!n || n.kind === 'group') return n;
      if (n.id === splitId && sizes.length === n.sizes.length) { const sum = sizes.reduce((a, b) => a + b, 0) || 1; return { ...n, sizes: sizes.map((s) => s / sum) }; }
      return { ...n, children: n.children.map((c) => walk(c) as LayoutNode) };
    };
    this.patchCanvas(this.project.active, (c) => ({ ...c, root: walk(c.root) }));
  }
  updatePanel(panelId: string, patch: Partial<PanelInstance>): void {
    const p = this.project.panels[panelId];
    if (!p) return;
    const next: PanelInstance = { ...p, ...patch };
    if (patch.name !== undefined) { const n = cleanName(patch.name, ''); if (n) next.name = n; else delete next.name; }
    if ('device' in patch && patch.device === undefined) delete next.device;
    this.commit({ ...this.project, panels: { ...this.project.panels, [panelId]: next } });
  }
  /** Panel settings that change often (an Analyzer's view). Saved like everything else. */
  setPanelConfig(panelId: string, config: Record<string, unknown>): void { this.updatePanel(panelId, { config }); }
}

