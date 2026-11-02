// The part of the workspace the user shapes: the canvas bar, the dock, the panel gallery and the dialogs that go with them.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PANEL_DEFS } from './panels';
import { useActiveCanvas, useProject, useProjectStore } from './context';
import { Dock } from './Dock';
import { groupById, panelsIn } from './layout';
import { MAX_CANVASES, PANEL_TYPES, TEMPLATES, type PanelType } from './project';
import { Modal, NameDialog, useContextMenu, useToast } from './ui';
import { CommandPalette, type Command } from './CommandPalette';
import { useHub, useHubState } from '../state/context';

export function usePhone(): boolean {
  const query = '(max-width: 700px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return undefined;
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

function PanelGallery({ onPick, onClose }: { onPick: (t: PanelType) => void; onClose: () => void }) {
  return (
    <Modal title="Add a panel" onClose={onClose} wide>
      <p className="bw-fine">Choose what this canvas shows. Panels that act on one device let you pick the device afterwards.</p>
      <ul className="bw-gallery">
        {PANEL_TYPES.map((t) => (
          <li key={t}>
            <button type="button" className="bw-gallery-card" onClick={() => onPick(t)}>
              <strong>{PANEL_DEFS[t].title}</strong>
              <span>{PANEL_DEFS[t].description}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function NewCanvasDialog({ onClose, canDuplicate }: { onClose: () => void; canDuplicate: boolean }) {
  const store = useProjectStore();
  const { project } = useProject();
  const toast = useToast();
  const [name, setName] = useState(`Canvas ${project.canvases.length + 1}`);
  const make = (template: string) => { if (store.addCanvas(name.trim() || name, template)) onClose(); else toast.show(`A project can have up to ${MAX_CANVASES} canvases.`); };
  return (
    <Modal title="New canvas" onClose={onClose} wide>
      <label className="bw-field"><span>Canvas name</span><input data-autofocus value={name} maxLength={48} onChange={(e) => setName(e.target.value)} /></label>
      <p className="bw-fine">Start from</p>
      <ul className="bw-gallery">
        <li><button type="button" className="bw-gallery-card" onClick={() => make('')}><strong>Blank canvas</strong><span>Empty. Add the panels you want.</span></button></li>
        {TEMPLATES.map((t) => (
          <li key={t.id}><button type="button" className="bw-gallery-card" onClick={() => make(t.id)}><strong>{t.label}</strong><span>{t.description}</span></button></li>
        ))}
        {canDuplicate && <li><button type="button" className="bw-gallery-card" onClick={() => { if (store.duplicateCanvas(project.active, name.trim() || undefined)) onClose(); }}><strong>Copy of this canvas</strong><span>A copy you can change freely.</span></button></li>}
      </ul>
    </Modal>
  );
}

/** Canvases as a row of tabs. Double-click or F2 renames, a right click (or the menu key) opens more. */
function CanvasBar({ onNew }: { onNew: () => void }) {
  const store = useProjectStore();
  const { project } = useProject();
  const toast = useToast();
  const menu = useContextMenu('Canvas');
  const [renaming, setRenaming] = useState<string | null>(null);
  const phone = usePhone();
  const del = useCallback((id: string) => {
    const name = project.canvases.find((c) => c.id === id)?.name ?? 'canvas';
    if (store.deleteCanvas(id)) toast.show(`Deleted “${name}”`, { label: 'Undo', run: () => store.undoDeleteCanvas() });
    else toast.show('A project needs at least one canvas.');
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
  if (phone) {
    return (
      <div className="bw-canvasbar bw-canvasbar-phone">
        <select aria-label="Canvas" value={project.active} onChange={(e) => (e.target.value === '__new' ? onNew() : store.setActive(e.target.value))}>
          {project.canvases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="__new">New canvas…</option>
        </select>
      </div>
    );
  }
  return (
    <nav className="bw-tabs bw-canvasbar" aria-label="Workspace">
      {project.canvases.map((c) => (
        <button
          key={c.id}
          type="button"
          className={c.id === project.active ? 'active' : ''}
          aria-current={c.id === project.active ? 'page' : undefined}
          onClick={() => store.setActive(c.id)}
          onDoubleClick={() => setRenaming(c.id)}
          onContextMenu={(e) => { e.preventDefault(); open(e.clientX, e.clientY, c.id); }}
          onKeyDown={(e) => {
            if (e.key === 'F2') { e.preventDefault(); setRenaming(c.id); }
            if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); open(r.left, r.bottom, c.id); }
          }}
        >
          {c.name}
        </button>
      ))}
      <button type="button" className="bw-canvas-new" onClick={onNew} aria-label="New canvas" title="New canvas">+</button>
      {menu.menu}
      {renamingCanvas && <NameDialog title="Rename canvas" label="Canvas name" initial={renamingCanvas.name} onSubmit={(v) => store.renameCanvas(renamingCanvas.id, v)} onClose={() => setRenaming(null)} />}
    </nav>
  );
}

function EmptyCanvas({ onAdd }: { onAdd: () => void }) {
  const store = useProjectStore();
  const { project } = useProject();
  return (
    <div className="bw-empty-canvas" data-testid="empty-canvas">
      <h2>This canvas is empty</h2>
      <p>Choose what you want to see. Each panel reads from the device you pick.</p>
      <div className="bw-actions">
        <button type="button" className="bw-button bw-primary" onClick={onAdd}>Add a panel</button>
        {TEMPLATES.slice(0, 3).map((t) => (
          <button key={t.id} type="button" className="bw-button" onClick={() => store.applyTemplate(project.active, t.id)}>
            Start from {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What the window bar shows to the right of the canvas tabs: the Add panel button, then whatever the caller passes (recording, databases). */
export function WorkspaceCanvas({ extras, showCanvas = true }: { extras?: ReactNode; showCanvas?: boolean }) {
  const store = useProjectStore();
  const canvas = useActiveCanvas();
  const { project } = useProject();
  const hub = useHub();
  const { slots } = useHubState();
  const phone = usePhone();
  const toast = useToast();
  const [focusedGroup, setFocusedGroup] = useState<string | null>(null);
  const [gallery, setGallery] = useState<{ groupId?: string } | null>(null);
  const [newCanvas, setNewCanvas] = useState(false);
  const [palette, setPalette] = useState(false);
  const [phonePanel, setPhonePanel] = useState<string | null>(null);

  const all = useMemo(() => panelsIn(canvas.root), [canvas.root]);
  const focus = focusedGroup && canvas.root && groupById(canvas.root, focusedGroup) ? focusedGroup : undefined;
  const pick = (t: PanelType) => {
    const pid = store.addPanel(t, gallery?.groupId ?? focus);
    setGallery(null);
    if (pid) setPhonePanel(pid); else toast.show('This canvas is full.');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const commands: Command[] = useMemo(() => [
    ...project.canvases.map((c) => ({ label: `Go to canvas: ${c.name}`, group: 'Canvas', run: () => store.setActive(c.id) })),
    { label: 'New canvas…', group: 'Canvas', run: () => setNewCanvas(true) },
    { label: 'Duplicate this canvas', group: 'Canvas', run: () => { store.duplicateCanvas(project.active); } },
    ...PANEL_TYPES.map((t) => ({ label: `Add panel: ${PANEL_DEFS[t].title}`, group: 'Panel', run: () => { store.addPanel(t, focus); } })),
    ...slots.length ? [{ label: 'Start capture on all devices', group: 'Capture', run: () => void hub.startAll() }, { label: 'Stop capture on all devices', group: 'Capture', run: () => void hub.stopAll() }] : [],
  ], [project.canvases, project.active, store, focus, slots.length, hub]);

  const currentPhone = phone && all.includes(phonePanel ?? '') ? phonePanel! : all[0] ?? null;
  const phoneGroup = phone && canvas.root && currentPhone ? { kind: 'group' as const, id: 'phone', tabs: [currentPhone], active: currentPhone } : null;

  return (
    <>
      <div className="bw-windowbar">
        <CanvasBar onNew={() => setNewCanvas(true)} />
        <div className="bw-windowbar-end">
          {extras}
          <button type="button" className="bw-button bw-small" onClick={() => setGallery({})}>Add panel</button>
          <button type="button" className="bw-button bw-small bw-palette-button" onClick={() => setPalette(true)} aria-label="Commands (Ctrl K)" title="Commands (Ctrl K)">Commands</button>
        </div>
      </div>
      {showCanvas && !canvas.root && <EmptyCanvas onAdd={() => setGallery({})} />}
      {showCanvas && canvas.root && !phoneGroup && <Dock root={canvas.root} panels={project.panels} focusedGroup={focus ?? null} onFocusGroup={setFocusedGroup} onAddPanel={(id) => setGallery({ groupId: id })} />}
      {showCanvas && canvas.root && phoneGroup && (
        <>
          <Dock root={phoneGroup} panels={project.panels} focusedGroup={null} onFocusGroup={() => undefined} onAddPanel={(id) => setGallery({ groupId: id })} />
          <nav className="bw-phone-switcher" aria-label="Panels on this canvas">
            {all.map((pid) => (
              <button key={pid} type="button" aria-pressed={pid === currentPhone} onClick={() => setPhonePanel(pid)}>{project.panels[pid] ? (project.panels[pid]!.name ?? PANEL_DEFS[project.panels[pid]!.type].title) : ''}</button>
            ))}
          </nav>
        </>
      )}
      {gallery && <PanelGallery onPick={pick} onClose={() => setGallery(null)} />}
      {newCanvas && <NewCanvasDialog canDuplicate={!!canvas.root} onClose={() => setNewCanvas(false)} />}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
    </>
  );
}
