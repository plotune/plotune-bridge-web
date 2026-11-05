// The part of the workspace the user shapes: canvas tabs, the dock, the panel gallery, the command palette and the dialogs that go with them.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { IconPanelAdd, IconPlus, IconSearch, IconSidebar } from '../components/icons';
import { useHub, useHubState } from '../state/context';
import { CommandPalette, type Command } from './CommandPalette';
import { useActiveCanvas, useProject, useProjectStore } from './context';
import { Dock } from './Dock';
import { groupById, groupOf, panelsIn, type DropZone, type GroupNode, type LayoutNode, type SplitNode } from './layout';
import { PANEL_DEFS, PANEL_ICONS, panelTitle } from './panels';
import { MAX_CANVASES, PANEL_TYPES, TEMPLATES, type PanelType } from './project';
import { ALT, MOD, combo, isEditable } from './shortcuts';
import { Modal, NameDialog, useContextMenu, useToast } from './ui';

export function usePhone(): boolean {
  return useMedia('(max-width: 700px)');
}

/** True while the explorer floats over the canvas instead of sitting beside it. */
export function useSheet(): boolean {
  return useMedia('(max-width: 900px)');
}

function useMedia(query: string): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return undefined;
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return phone;
}

interface Ui {
  openGallery(groupId?: string): void;
  openNewCanvas(): void;
  openPalette(): void;
  toggleExplorer(): void;
  focusedGroup: string | null;
  setFocusedGroup(id: string | null): void;
  phonePanel: string | null;
  setPhonePanel(id: string | null): void;
}
const UiContext = createContext<Ui | null>(null);
export function useWorkspaceUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error('WorkspaceUiProvider is missing');
  return ui;
}

function PanelGallery({ onPick, onClose }: { onPick: (t: PanelType) => void; onClose: () => void }) {
  return (
    <Modal title="Add a panel" onClose={onClose} wide>
      <ul className="bw-gallery">
        {PANEL_TYPES.map((t) => {
          const Icon = PANEL_ICONS[t];
          return (
            <li key={t}>
              <button type="button" className="bw-gallery-card" onClick={() => onPick(t)}>
                <span className="bw-gallery-icon"><Icon /></span>
                <span><strong>{PANEL_DEFS[t].title}</strong><small>{PANEL_DEFS[t].description}</small></span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function NewCanvasDialog({ onClose, canDuplicate }: { onClose: () => void; canDuplicate: boolean }) {
  const store = useProjectStore();
  const { project } = useProject();
  const toast = useToast();
  const [name, setName] = useState(`Canvas ${project.canvases.length + 1}`);
  const make = (template: string) => { if (store.addCanvas(name.trim() || name, template)) onClose(); else toast.show(`A workspace can have up to ${MAX_CANVASES} canvases.`); };
  return (
    <Modal title="New canvas" onClose={onClose} wide>
      <label className="bw-labelled"><span>Canvas name</span><input data-autofocus value={name} maxLength={48} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') make(''); }} /></label>
      <p className="bw-fine">Start from</p>
      <ul className="bw-gallery">
        <li><button type="button" className="bw-gallery-card" onClick={() => make('')}><span><strong>Blank canvas</strong><small>Empty. Add the panels you want.</small></span></button></li>
        {TEMPLATES.map((t) => (
          <li key={t.id}><button type="button" className="bw-gallery-card" onClick={() => make(t.id)}><span><strong>{t.label}</strong><small>{t.description}</small></span></button></li>
        ))}
        {canDuplicate && <li><button type="button" className="bw-gallery-card" onClick={() => { if (store.duplicateCanvas(project.active, name.trim() || undefined)) onClose(); }}><span><strong>Copy of this canvas</strong><small>A copy you can change freely.</small></span></button></li>}
      </ul>
    </Modal>
  );
}

/** Owns the dialogs, the shortcuts and the command palette of the workspace, and lets the bars and the canvas open them. */
export function WorkspaceUiProvider({ children, onToggleExplorer, extraCommands = [] }: { children: ReactNode; onToggleExplorer: () => void; extraCommands?: Command[] }) {
  const store = useProjectStore();
  const canvas = useActiveCanvas();
  const { project } = useProject();
  const hub = useHub();
  const { slots } = useHubState();
  const toast = useToast();
  const [focusedGroup, setFocusedGroup] = useState<string | null>(null);
  const [gallery, setGallery] = useState<{ groupId?: string } | null>(null);
  const [newCanvas, setNewCanvas] = useState(false);
  const [palette, setPalette] = useState(false);
  const [phonePanel, setPhonePanel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const focus = focusedGroup && canvas.root && groupById(canvas.root, focusedGroup) ? focusedGroup : undefined;
  const pick = (t: PanelType) => {
    const pid = store.addPanel(t, gallery?.groupId);
    setGallery(null);
    if (pid) setPhonePanel(pid); else toast.show('This canvas is full.');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (mod && key === 'b' && !e.altKey) { e.preventDefault(); onToggleExplorer(); return; }
      if (e.altKey && !mod && !isEditable(e.target) && !document.querySelector('[role=dialog]')) {
        if (e.code === 'KeyN') { e.preventDefault(); setNewCanvas(true); }
        else if (e.code === 'KeyP') { e.preventDefault(); setGallery({}); }
        else if (/^Digit[1-9]$/.test(e.code)) {
          const c = store.getState().project.canvases[Number(e.code.slice(5)) - 1];
          if (c) { e.preventDefault(); store.setActive(c.id); }
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onToggleExplorer, store]);

  const commands: Command[] = useMemo(() => [
    ...project.canvases.map((c, i) => ({ label: `Go to canvas: ${c.name}`, group: 'Canvas', hint: i < 9 ? combo(ALT, String(i + 1)) : undefined, run: () => store.setActive(c.id) })),
    { label: 'New canvas…', group: 'Canvas', hint: combo(ALT, 'N'), run: () => setNewCanvas(true) },
    { label: 'Rename this canvas…', group: 'Canvas', run: () => setRenaming(true) },
    { label: 'Duplicate this canvas', group: 'Canvas', run: () => { store.duplicateCanvas(project.active); } },
    { label: 'Add panel…', group: 'Panel', hint: combo(ALT, 'P'), run: () => setGallery({}) },
    ...PANEL_TYPES.map((t) => ({ label: `Add panel: ${PANEL_DEFS[t].title}`, group: 'Panel', run: () => { store.addPanel(t); } })),
    { label: 'Show or hide the explorer', group: 'View', hint: combo(MOD, 'B'), run: onToggleExplorer },
    { label: 'Add a device', group: 'Device', run: () => hub.addDevice() },
    ...(slots.length ? [{ label: 'Start capture on all devices', group: 'Capture', run: () => void hub.startAll() }, { label: 'Stop capture on all devices', group: 'Capture', run: () => void hub.stopAll() }] : []),
    ...extraCommands,
  ], [project.canvases, project.active, store, slots.length, hub, onToggleExplorer, extraCommands]);

  const ui = useMemo<Ui>(() => ({
    openGallery: (groupId) => setGallery({ groupId }),
    openNewCanvas: () => setNewCanvas(true),
    openPalette: () => setPalette(true),
    toggleExplorer: onToggleExplorer,
    focusedGroup: focus ?? null,
    setFocusedGroup,
    phonePanel,
    setPhonePanel,
  }), [onToggleExplorer, focus, phonePanel]);

  return (
    <UiContext.Provider value={ui}>
      {children}
      {gallery && <PanelGallery onPick={pick} onClose={() => setGallery(null)} />}
      {newCanvas && <NewCanvasDialog canDuplicate={!!canvas.root} onClose={() => setNewCanvas(false)} />}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {renaming && <NameDialog title="Rename canvas" label="Canvas name" initial={canvas.name} onSubmit={(v) => store.renameCanvas(canvas.id, v)} onClose={() => setRenaming(false)} />}
    </UiContext.Provider>
  );
}

/** Canvases as one rounded segmented control. Double-click or F2 renames, a right click (or the menu key) opens more. */
export function CanvasTabs() {
  const store = useProjectStore();
  const { project } = useProject();
  const ui = useWorkspaceUi();
  const toast = useToast();
  const menu = useContextMenu('Canvas');
  const phone = usePhone();
  const [renaming, setRenaming] = useState<string | null>(null);
  const del = useCallback((id: string) => {
    const name = project.canvases.find((c) => c.id === id)?.name ?? 'canvas';
    if (store.deleteCanvas(id)) toast.show(`Deleted “${name}”`, { label: 'Undo', run: () => store.undoDeleteCanvas() });
    else toast.show('A workspace needs at least one canvas.');
  }, [project.canvases, store, toast]);
  const open = (x: number, y: number, id: string) => menu.open(x, y, [
    { label: 'Rename…', hint: 'F2', onSelect: () => setRenaming(id) },
    { label: 'Duplicate', onSelect: () => { store.setActive(id); store.duplicateCanvas(id); } },
    { label: 'Move left', onSelect: () => store.moveCanvas(id, -1) },
    { label: 'Move right', onSelect: () => store.moveCanvas(id, 1) },
    { separator: true },
    { label: 'Delete canvas', onSelect: () => del(id) },
  ]);
  const renamingCanvas = project.canvases.find((c) => c.id === renaming);
  if (phone) return <PhoneCanvasPicker onDelete={del} />;
  return (
    <div className="bw-canvas-tabs">
      <nav className="bw-segmented" aria-label="Canvases">
        {project.canvases.map((c) => (
          <button
            key={c.id}
            type="button"
            className={c.id === project.active ? 'active' : ''}
            aria-current={c.id === project.active ? 'page' : undefined}
            title={`${c.name} (double-click to rename)`}
            aria-keyshortcuts="Delete"
            onClick={() => store.setActive(c.id)}
            onDoubleClick={() => setRenaming(c.id)}
            onContextMenu={(e) => { e.preventDefault(); open(e.clientX, e.clientY, c.id); }}
            onKeyDown={(e) => {
              if (e.key === 'F2') { e.preventDefault(); setRenaming(c.id); }
              if (e.key === 'Delete') { e.preventDefault(); del(c.id); }
              if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); open(r.left, r.bottom, c.id); }
            }}
          >
            {c.name}
            {/* A pointer shortcut: the keyboard deletes with Delete or from the menu, so this is not a second tab stop. */}
            {project.canvases.length > 1 && (
              <span className="bw-seg-close" aria-hidden="true" title={`Delete ${c.name}`} onClick={(e) => { e.stopPropagation(); del(c.id); }}>×</span>
            )}
          </button>
        ))}
      </nav>
      <button type="button" className="bw-icon-button" onClick={ui.openNewCanvas} aria-label="New canvas" title={`New canvas (${combo(ALT, 'N')})`}>
        <IconPlus />
      </button>
      {menu.menu}
      {renamingCanvas && <NameDialog title="Rename canvas" label="Canvas name" initial={renamingCanvas.name} onSubmit={(v) => store.renameCanvas(renamingCanvas.id, v)} onClose={() => setRenaming(null)} />}
    </div>
  );
}

/** Unmount picker dialogs when leaving the phone layout. */
function PhoneCanvasPicker({ onDelete }: { onDelete: (id: string) => void }) {
  const store = useProjectStore();
  const { project } = useProject();
  const ui = useWorkspaceUi();
  const [choosing, setChoosing] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const renamingCanvas = project.canvases.find((c) => c.id === renaming);
  const active = project.canvases.find((c) => c.id === project.active)!;
  return (
    <nav className="bw-canvas-picker" aria-label="Canvases">
      <button type="button" className="bw-button bw-canvas-picker-trigger" aria-label={`Choose canvas: ${active.name}`} aria-haspopup="dialog" aria-expanded={choosing} onClick={() => setChoosing(true)}>
        <span>{active.name}</span><span aria-hidden="true">▾</span>
      </button>
      {choosing && <Modal title="Canvases" onClose={() => setChoosing(false)}>
        <ul className="bw-canvas-picker-list">
          {project.canvases.map((c) => <li key={c.id}>
            <button type="button" className="bw-button" aria-label={`Open canvas ${c.name}`} aria-current={c.id === project.active ? 'page' : undefined} onClick={() => { store.setActive(c.id); setChoosing(false); }}>{c.name}</button>
          </li>)}
        </ul>
        <div className="bw-layout-actions">
          <button type="button" className="bw-button" onClick={() => { setChoosing(false); ui.openNewCanvas(); }} disabled={project.canvases.length >= MAX_CANVASES}>New canvas</button>
          <button type="button" className="bw-button" onClick={() => { setChoosing(false); setRenaming(active.id); }}>Rename canvas</button>
          <button type="button" className="bw-button" onClick={() => { store.duplicateCanvas(active.id); setChoosing(false); }} disabled={project.canvases.length >= MAX_CANVASES}>Duplicate canvas</button>
          <button type="button" className="bw-button" onClick={() => store.moveCanvas(active.id, -1)} disabled={project.canvases[0]?.id === active.id}>Move canvas left</button>
          <button type="button" className="bw-button" onClick={() => store.moveCanvas(active.id, 1)} disabled={project.canvases.at(-1)?.id === active.id}>Move canvas right</button>
          <button type="button" className="bw-button" onClick={() => onDelete(active.id)} disabled={project.canvases.length === 1}>Delete canvas</button>
        </div>
      </Modal>}
      {renamingCanvas && <NameDialog title="Rename canvas" label="Canvas name" initial={renamingCanvas.name} onSubmit={(v) => store.renameCanvas(renamingCanvas.id, v)} onClose={() => { setRenaming(null); setChoosing(true); }} />}
    </nav>
  );
}

/** Explicit touch/keyboard alternatives to dragging tabs and dividers. Edits the saved dock,
 * while the phone continues to show one panel at a time. No device command is issued. */
function PhoneLayoutEditor({ panelId, onClose }: { panelId: string; onClose: () => void }) {
  const store = useProjectStore();
  const canvas = useActiveCanvas();
  const { project } = useProject();
  const panel = project.panels[panelId]!;
  const [name, setName] = useState(panelTitle(panel));
  const [target, setTarget] = useState('');
  const [zone, setZone] = useState<DropZone>('center');
  const [message, setMessage] = useState('');
  const others = panelsIn(canvas.root).filter((id) => id !== panelId);
  const targetGroup = groupOf(canvas.root, target);
  const sourceGroup = groupOf(canvas.root, panelId);
  const canMove = !!targetGroup && !!sourceGroup && (targetGroup.id !== sourceGroup.id || zone !== 'center');
  const dividers: { split: SplitNode; index: number }[] = [];
  const walk = (node: LayoutNode | null) => {
    if (!node || node.kind === 'group') return;
    node.children.slice(0, -1).forEach((_, index) => dividers.push({ split: node, index }));
    node.children.forEach(walk);
  };
  walk(canvas.root);
  return <Modal title="Edit panel layout" onClose={onClose}>
    <p>Editing <strong>{panelTitle(panel)}</strong>. The saved layout is also used on larger screens.</p>
    <label className="bw-labelled"><span>Panel name</span><input value={name} maxLength={48} onChange={(e) => setName(e.target.value)} /></label>
    <button type="button" className="bw-button" disabled={!name.trim() || name.trim() === panelTitle(panel)} onClick={() => { store.updatePanel(panelId, { name }); setMessage('Panel renamed.'); }}>Save panel name</button>
    {others.length > 0 && <>
      <label className="bw-labelled"><span>Move beside panel</span><select value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Choose a panel</option>
        {others.map((id, index) => <option key={id} value={id}>{panelTitle(project.panels[id]!)} ({index + 1})</option>)}
      </select></label>
      <label className="bw-labelled"><span>Position</span><select value={zone} onChange={(e) => setZone(e.target.value as DropZone)}>
        <option value="center">As a tab</option><option value="left">Left</option><option value="right">Right</option><option value="top">Above</option><option value="bottom">Below</option>
      </select></label>
      <button type="button" className="bw-button" disabled={!canMove} onClick={() => { if (targetGroup) { store.movePanel(panelId, targetGroup.id, zone); setMessage('Panel moved.'); } }}>Move panel</button>
    </>}
    {dividers.length > 0 && <fieldset className="bw-layout-dividers"><legend>Resize saved layout</legend>
      {dividers.map(({ split, index }, i) => <div className="bw-layout-divider" key={`${split.id}-${index}`}>
        <span>Divider {i + 1} · {split.dir === 'row' ? 'left / right' : 'top / bottom'} · {Math.round(split.sizes[index]! * 100)}%</span>
        <div className="bw-layout-actions">
          <button type="button" className="bw-button" aria-label={`Shrink first panel at divider ${i + 1} (−5%)`} disabled={split.sizes[index]! <= 0.100001} onClick={() => store.resize(split.id, index, -0.05)}>−5%</button>
          <button type="button" className="bw-button" aria-label={`Grow first panel at divider ${i + 1} (+5%)`} disabled={split.sizes[index + 1]! <= 0.100001} onClick={() => store.resize(split.id, index, 0.05)}>+5%</button>
        </div>
      </div>)}
    </fieldset>}
    <p role="status">{message}</p>
    <button type="button" className="bw-button" onClick={() => {
      onClose();
      store.closePanel(panelId);
      // The editor trigger disappears when the last panel closes. Focus the next
      // usable action after React has rendered the remaining panel or empty canvas.
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.bw-phone-switcher [aria-label="Edit panel layout"], [data-testid="empty-canvas"] button')?.focus());
    }}>Close panel</button>
  </Modal>;
}

/** The top bar's three canvas tools: the explorer, add a panel, and the command search. */
export function ExplorerToggle({ open }: { open: boolean }) {
  const ui = useWorkspaceUi();
  return (
    <button type="button" className="bw-icon-button" onClick={ui.toggleExplorer} aria-label="Explorer" aria-pressed={open} title={`Explorer (${combo(MOD, 'B')})`}>
      <IconSidebar />
    </button>
  );
}
export function AddPanelButton() {
  const ui = useWorkspaceUi();
  return (
    <button type="button" className="bw-icon-button" onClick={() => ui.openGallery()} aria-label="Add panel" title={`Add panel (${combo(ALT, 'P')})`}>
      <IconPanelAdd />
    </button>
  );
}
export function CommandButton() {
  const ui = useWorkspaceUi();
  return (
    <button type="button" className="bw-command-pill" onClick={ui.openPalette} title={`Search and commands (${combo(MOD, 'K')})`}>
      <IconSearch />
      <span className="bw-pill-label">Search</span>
      <kbd aria-hidden="true">{combo(MOD, 'K')}</kbd>
    </button>
  );
}

/** Three starting points on an empty canvas, and the way to everything else. Nothing else competes for the space. */
function EmptyCanvas() {
  const store = useProjectStore();
  const ui = useWorkspaceUi();
  const { slots } = useHubState();
  // Capture can be running while this canvas shows nothing; say so, and point at the one thing that shows the frames (U6).
  const capturing = slots.some((slot) => {
    const state = slot.store.getState();
    return state.phase === 'connected' && state.capturing;
  });
  const starters: PanelType[] = ['trace', 'plot', 'analyzer'];
  return (
    <div className="bw-empty-canvas" data-testid="empty-canvas">
      {capturing && (
        <p className="bw-empty-capture-hint" role="status" data-testid="capture-hint">
          Capturing. Add a Trace to watch the frames.
        </p>
      )}
      <div className="bw-starters">
        {starters.map((t) => {
          const Icon = PANEL_ICONS[t];
          return (
            <button key={t} type="button" className="bw-starter" onClick={() => store.addPanel(t)} title={PANEL_DEFS[t].description}>
              <Icon />
              {PANEL_DEFS[t].title}
            </button>
          );
        })}
      </div>
      <p>or press <kbd>{combo(MOD, 'K')}</kbd> for everything else</p>
      <button type="button" className="bw-link-button" onClick={() => ui.openGallery()}>Browse panels</button>
    </div>
  );
}

/** The canvas: the dock, or one panel at a time on a phone with a bar to switch between them. */
export function CanvasView() {
  const canvas = useActiveCanvas();
  const { project } = useProject();
  const ui = useWorkspaceUi();
  const phone = usePhone();
  const all = useMemo(() => panelsIn(canvas.root), [canvas.root]);
  const currentPhone = phone && all.includes(ui.phonePanel ?? '') ? ui.phonePanel! : all[0] ?? null;
  const phoneGroup = phone && canvas.root && currentPhone ? { kind: 'group' as const, id: 'phone', tabs: [currentPhone], active: currentPhone } : null;
  if (!canvas.root) return <EmptyCanvas />;
  if (phoneGroup) {
    return <PhoneCanvas key={canvas.id} root={phoneGroup} panelIds={all} currentPanel={currentPhone!} />;
  }
  return <Dock root={canvas.root} panels={project.panels} focusedGroup={ui.focusedGroup} onFocusGroup={ui.setFocusedGroup} />;
}

/** Local editing state ends when this phone view or its canvas is left. */
function PhoneCanvas({ root, panelIds, currentPanel }: { root: GroupNode; panelIds: string[]; currentPanel: string }) {
  const { project } = useProject();
  const ui = useWorkspaceUi();
  const [editing, setEditing] = useState(false);
  return (
      <>
        <Dock root={root} panels={project.panels} focusedGroup={null} onFocusGroup={() => undefined} />
        <nav className="bw-phone-switcher" aria-label="Panels on this canvas">
          <button type="button" className="bw-icon-button" onClick={ui.toggleExplorer} aria-label="Explorer" title="Explorer"><IconSidebar /></button>
          <div className="bw-phone-chips">
            {panelIds.map((pid) => (
              <button key={pid} type="button" aria-pressed={pid === currentPanel} onClick={() => ui.setPhonePanel(pid)}>{project.panels[pid] ? (project.panels[pid]!.name ?? PANEL_DEFS[project.panels[pid]!.type].title) : ''}</button>
            ))}
          </div>
          <button type="button" className="bw-icon-button" onClick={() => ui.openGallery()} aria-label="Add panel" title="Add panel"><IconPanelAdd /></button>
          <button type="button" className="bw-button" onClick={() => setEditing(true)} aria-label="Edit panel layout">Edit</button>
        </nav>
        {editing && <PhoneLayoutEditor key={currentPanel} panelId={currentPanel} onClose={() => setEditing(false)} />}
      </>
  );
}
