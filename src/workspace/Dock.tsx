import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { IconMaximize, IconRestore } from '../components/icons';
import { PanelDomIdContext, DockedContext, useProjectStore } from './context';
import { beginDrag, justDragged, zoneAt, zoneRect } from './drag';
import { groupById, panelsIn, type DropZone, type GroupNode, type LayoutNode, type SplitNode } from './layout';
import { PanelHost, panelTitle } from './panels';
import type { PanelInstance } from './project';
import { NameDialog, useContextMenu } from './ui';

interface DockProps {
  root: LayoutNode;
  panels: Record<string, PanelInstance>;
  focusedGroup: string | null;
  onFocusGroup: (id: string) => void;
}

/** DOM ids: the first panel of a type keeps the id it always had (#panel-trace); later ones use their own id. */
export function domIds(root: LayoutNode, panels: Record<string, PanelInstance>): Record<string, string> {
  const seen = new Set<string>();
  const out: Record<string, string> = {};
  for (const pid of panelsIn(root)) {
    const t = panels[pid]?.type;
    if (!t) continue;
    out[pid] = seen.has(t) ? `panel-${pid}` : `panel-${t}`;
    seen.add(t);
  }
  return out;
}

export function Dock({ root, panels, focusedGroup, onFocusGroup }: DockProps) {
  const store = useProjectStore();
  const [maximized, setMaximized] = useState<string | null>(null);
  const ids = domIds(root, panels);
  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role=dialog],[role=menu]')) setMaximized(null); };
    document.addEventListener('keydown', onKey as EventListener);
    return () => document.removeEventListener('keydown', onKey as EventListener);
  }, [maximized]);
  // A maximized group is drawn over the others, which stay mounted (so a paused trace or a zoomed plot keeps its state) but inert.
  const active = maximized && groupById(root, maximized) ? maximized : null;
  const props = { store, panels, ids, focusedGroup, onFocusGroup, maximized: active, setMaximized };
  return <div className="bw-workspace" data-testid="dock"><NodeView node={root} {...props} /></div>;
}

interface Shared {
  store: ReturnType<typeof useProjectStore>;
  panels: Record<string, PanelInstance>;
  ids: Record<string, string>;
  focusedGroup: string | null;
  onFocusGroup: (id: string) => void;
  maximized: string | null;
  setMaximized: (id: string | null) => void;
}

function NodeView({ node, ...shared }: { node: LayoutNode } & Shared) {
  return node.kind === 'group' ? <GroupView group={node} {...shared} /> : <SplitView split={node} {...shared} />;
}

function SplitView({ split, ...shared }: { split: SplitNode } & Shared) {
  const ref = useRef<HTMLDivElement>(null);
  const row = split.dir === 'row';
  const startDrag = (e: ReactPointerEvent, index: number) => {
    const host = ref.current;
    if (!host) return;
    e.preventDefault();
    const total = row ? host.clientWidth : host.clientHeight;
    const start = row ? e.clientX : e.clientY;
    const kids = [...host.children].filter((c) => !(c as HTMLElement).dataset.divider) as HTMLElement[];
    const a0 = split.sizes[index]!;
    const b0 = split.sizes[index + 1]!;
    let sizes = split.sizes.slice();
    const move = (ev: PointerEvent) => {
      const d = ((row ? ev.clientX : ev.clientY) - start) / total;
      const a = Math.min(a0 + b0 - 0.1, Math.max(0.1, a0 + d));
      sizes = split.sizes.slice();
      sizes[index] = a;
      sizes[index + 1] = a0 + b0 - a;
      kids[index]!.style.flex = `${a} 1 0`;
      kids[index + 1]!.style.flex = `${a0 + b0 - a} 1 0`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      shared.store.setSizes(split.id, sizes);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onKey = (e: KeyboardEvent, index: number) => {
    const keys = row ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (e.key === keys[0]) { e.preventDefault(); shared.store.resize(split.id, index, -0.03); }
    if (e.key === keys[1]) { e.preventDefault(); shared.store.resize(split.id, index, 0.03); }
  };
  const items: React.ReactNode[] = [];
  split.children.forEach((child, i) => {
    items.push(<SplitChild key={child.id} share={split.sizes[i]!}><NodeView node={child} {...shared} /></SplitChild>);
    if (i < split.children.length - 1) {
      items.push(<div key={`divider-${child.id}`} data-divider="1" className="bw-divider" role="separator" tabIndex={0} aria-orientation={row ? 'vertical' : 'horizontal'} aria-label="Resize panels" aria-valuemin={10} aria-valuemax={90} aria-valuenow={Math.round(split.sizes[i]! * 100)} onPointerDown={(e) => startDrag(e, i)} onKeyDown={(e) => onKey(e, i)} />);
    }
  });
  return <div ref={ref} className={`bw-split bw-split-${split.dir}`}>{items}</div>;
}
function SplitChild({ share, children }: { share: number; children: React.ReactNode }) {
  const style: CSSProperties = { flex: `${share} 1 0` };
  return <div className="bw-split-child" style={style}>{children}</div>;
}

function GroupView({ group, store, panels, ids, focusedGroup, onFocusGroup, maximized, setMaximized }: { group: GroupNode } & Shared) {
  const menu = useContextMenu('Panel');
  const [renaming, setRenaming] = useState<string | null>(null);
  const focused = focusedGroup === group.id;
  const activate = (pid: string) => store.setActiveTab(group.id, pid);

  const startTabDrag = (e: ReactPointerEvent, pid: string) => {
    const instance = panels[pid];
    if (!instance) return;
    beginDrag(e, panelTitle(instance), {
      target: (x, y) => {
        const el = document.elementsFromPoint(x, y).find((n) => (n as HTMLElement).dataset?.dockGroup) as HTMLElement | undefined;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const zone = zoneAt(rect, x, y);
        return { value: { groupId: el.dataset.dockGroup!, zone }, rect: zoneRect(rect, zone) };
      },
      drop: (v: { groupId: string; zone: DropZone }) => store.movePanel(pid, v.groupId, v.zone),
    });
  };

  const tabMenu = (x: number, y: number, pid: string) => {
    const instance = panels[pid]!;
    menu.open(x, y, [
      { label: 'Rename…', onSelect: () => setRenaming(pid) },
      { label: 'Split right', onSelect: () => store.movePanel(pid, group.id, 'right'), disabled: group.tabs.length < 2 },
      { label: 'Split down', onSelect: () => store.movePanel(pid, group.id, 'bottom'), disabled: group.tabs.length < 2 },
      { label: maximized === group.id ? 'Restore' : 'Maximize', hint: 'Esc', onSelect: () => setMaximized(maximized === group.id ? null : group.id) },
      { separator: true },
      { label: `Close ${panelTitle(instance)}`, onSelect: () => store.closePanel(pid) },
    ]);
  };

  const onTabKey = (e: KeyboardEvent, pid: string) => {
    const i = group.tabs.indexOf(pid);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = group.tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + group.tabs.length) % group.tabs.length]!;
      activate(next);
      requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
    }
    if (e.key === 'Delete') { e.preventDefault(); store.closePanel(pid); }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      tabMenu(r.left, r.bottom, pid);
    }
  };

  const setFocus = useCallback(() => onFocusGroup(group.id), [onFocusGroup, group.id]);
  return (
    <section className={`bw-group ${focused ? 'is-focused' : ''} ${maximized === group.id ? 'is-maximized' : ''}`} inert={maximized !== null && maximized !== group.id ? true : undefined} data-dock-group={group.id} data-single={group.tabs.length === 1} onPointerDownCapture={setFocus} onFocusCapture={setFocus} aria-label="Panel group">
      <div className="bw-group-tabs">
        <div className="bw-tablist" role="tablist" aria-label="Panels in this group">
          {group.tabs.map((pid) => {
            const inst = panels[pid];
            if (!inst) return null;
            const selected = pid === group.active;
            return (
              <div key={pid} className="bw-tab" role="presentation" data-selected={selected}>
                <button
                  type="button"
                  role="tab"
                  id={`tab-${pid}`}
                  aria-selected={selected}
                  aria-controls={`tabpanel-${pid}`}
                  aria-keyshortcuts="Delete"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => { if (!justDragged) activate(pid); }}
                  onPointerDown={(e) => startTabDrag(e, pid)}
                  onContextMenu={(e) => { e.preventDefault(); tabMenu(e.clientX, e.clientY, pid); }}
                  onKeyDown={(e) => onTabKey(e, pid)}
                >
                  {panelTitle(inst)}
                  {/* A pointer shortcut. The keyboard closes a tab with Delete or from its menu, so this is not a second tab stop. */}
                  <span className="bw-tab-close" aria-hidden="true" title={`Close ${panelTitle(inst)}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); store.closePanel(pid); }}>×</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="bw-group-tools">
          <button type="button" className="bw-icon-button" aria-pressed={maximized === group.id} aria-label={maximized === group.id ? 'Restore this group' : 'Maximize this group'} title={maximized === group.id ? 'Restore (Esc)' : 'Maximize'} onClick={() => setMaximized(maximized === group.id ? null : group.id)}>
            {maximized === group.id ? <IconRestore /> : <IconMaximize />}
          </button>
        </div>
      </div>
      <div className="bw-group-body">
        {group.tabs.map((pid) => {
          const inst = panels[pid];
          if (!inst) return null;
          return (
            <div key={pid} id={`tabpanel-${pid}`} role="tabpanel" aria-labelledby={`tab-${pid}`} className="bw-tabpanel" hidden={pid !== group.active}>
              <DockedContext.Provider value>
                <PanelDomIdContext.Provider value={ids[pid] ?? null}>
                  <PanelHost pid={pid} instance={inst} onUseSelected={() => store.updatePanel(pid, { device: undefined })} />
                </PanelDomIdContext.Provider>
              </DockedContext.Provider>
            </div>
          );
        })}
      </div>
      {menu.menu}
      {renaming && <NameDialog title="Rename panel" label="Panel name" initial={panelTitle(panels[renaming]!)} onSubmit={(v) => store.updatePanel(renaming, { name: v })} onClose={() => setRenaming(null)} />}
    </section>
  );
}
