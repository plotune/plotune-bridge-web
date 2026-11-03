// The part of the workspace the user shapes: canvas tabs, the dock, the panel gallery, the command palette and the dialogs that go with them.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { IconPanelAdd, IconPlus, IconSearch, IconSidebar } from '../components/icons';
import { useHub, useHubState } from '../state/context';
import { CommandPalette, type Command } from './CommandPalette';
import { useActiveCanvas, useProject, useProjectStore } from './context';
import { Dock } from './Dock';
import { groupById, panelsIn } from './layout';
import { PANEL_DEFS, PANEL_ICONS } from './panels';
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
    const pid = store.addPanel(t, gallery?.groupId ?? focus);
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
    ...PANEL_TYPES.map((t) => ({ label: `Add panel: ${PANEL_DEFS[t].title}`, group: 'Panel', run: () => { store.addPanel(t, focus); } })),
    { label: 'Show or hide the explorer', group: 'View', hint: combo(MOD, 'B'), run: onToggleExplorer },
    { label: 'Add a device', group: 'Device', run: () => hub.addDevice() },
    ...(slots.length ? [{ label: 'Start capture on all devices', group: 'Capture', run: () => void hub.startAll() }, { label: 'Stop capture on all devices', group: 'Capture', run: () => void hub.stopAll() }] : []),
    ...extraCommands,
  ], [project.canvases, project.active, store, focus, slots.length, hub, onToggleExplorer, extraCommands]);

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
  const starters: PanelType[] = ['trace', 'plot', 'analyzer'];
  return (
    <div className="bw-empty-canvas" data-testid="empty-canvas">
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
    return (
      <>
        <Dock root={phoneGroup} panels={project.panels} focusedGroup={null} onFocusGroup={() => undefined} onAddPanel={(id) => ui.openGallery(id)} />
        <nav className="bw-phone-switcher" aria-label="Panels on this canvas">
          <button type="button" className="bw-icon-button" onClick={ui.toggleExplorer} aria-label="Explorer" title="Explorer"><IconSidebar /></button>
          <div className="bw-phone-chips">
            {all.map((pid) => (
              <button key={pid} type="button" aria-pressed={pid === currentPhone} onClick={() => ui.setPhonePanel(pid)}>{project.panels[pid] ? (project.panels[pid]!.name ?? PANEL_DEFS[project.panels[pid]!.type].title) : ''}</button>
            ))}
          </div>
          <button type="button" className="bw-icon-button" onClick={() => ui.openGallery()} aria-label="Add panel" title="Add panel"><IconPanelAdd /></button>
        </nav>
      </>
    );
  }
  return <Dock root={canvas.root} panels={project.panels} focusedGroup={ui.focusedGroup} onFocusGroup={ui.setFocusedGroup} onAddPanel={(id) => ui.openGallery(id)} />;
}
