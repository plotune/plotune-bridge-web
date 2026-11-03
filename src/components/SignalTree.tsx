import { useMemo, useRef, useState } from 'react';
import { IconChevron, IconChevronRight } from './icons';

export interface TreeSignal { id: string; name: string; unit?: string }
export interface TreeGroup {
  id: string;
  /** What the group is called: a message name. */
  title: string;
  /** Where it comes from: "Bridge 2 · CAN1". */
  subtitle: string;
  signals: TreeSignal[];
}

type Row = { kind: 'group'; group: TreeGroup; count: number; open: boolean } | { kind: 'signal'; group: TreeGroup; signal: TreeSignal };
const ROW = 30;
const OVERSCAN = 8;

/**
 * A searchable list of signals grouped by message, built for databases with thousands of signals: only the rows in view are drawn,
 * groups are closed until a search opens them, and a search looks at message names, source names and signal names together.
 */
export function SignalTree({ groups, chosen, onToggle, canAdd = true, height = 280, label = 'Choose signals' }: { groups: readonly TreeGroup[]; chosen: ReadonlySet<string>; onToggle: (group: TreeGroup, signal: TreeSignal, on: boolean) => void; canAdd?: boolean; height?: number; label?: string }) {
  const [search, setSearch] = useState('');
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const needle = search.trim().toLowerCase();
  const total = useMemo(() => groups.reduce((n, g) => n + g.signals.length, 0), [groups]);
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const group of groups) {
      const head = `${group.subtitle} ${group.title}`.toLowerCase();
      const headHit = needle !== '' && head.includes(needle);
      const signals = needle === '' || headHit ? group.signals : group.signals.filter((s) => s.name.toLowerCase().includes(needle));
      if (signals.length === 0) continue;
      // A search opens what it found; with no search, a short list is open and a long one is closed.
      const open = needle !== '' ? true : openIds.has(group.id) || (total <= 60 && !openIds.has(`-${group.id}`));
      out.push({ kind: 'group', group, count: signals.length, open });
      if (open) for (const signal of signals) out.push({ kind: 'signal', group, signal });
    }
    return out;
  }, [groups, needle, openIds, total]);
  const toggleGroup = (g: TreeGroup, open: boolean) =>
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (open) { next.delete(`-${g.id}`); next.add(g.id); } else { next.delete(g.id); next.add(`-${g.id}`); }
      return next;
    });
  const box = useRef<HTMLDivElement>(null);
  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN);
  return (
    <div className="bw-tree" role="group" aria-label={label}>
      <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setScrollTop(0); box.current?.scrollTo?.(0, 0); }} placeholder="Search messages and signals (e.g. EngineSpeed)" aria-label="Search signals" />
      <p className="bw-fine">{total.toLocaleString()} {total === 1 ? 'signal' : 'signals'} in {groups.length.toLocaleString()} {groups.length === 1 ? 'message' : 'messages'}{needle ? ` · ${rows.filter((r) => r.kind === 'signal').length.toLocaleString()} match` : ''}</p>
      <div ref={box} className="bw-tree-scroll" style={{ height }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} tabIndex={-1}>
        <ul className="bw-tree-rows" style={{ height: rows.length * ROW }}>
          {rows.slice(first, last).map((r, i) => {
            const top = (first + i) * ROW;
            if (r.kind === 'group') {
              return (
                <li key={`g-${r.group.id}`} className="bw-tree-group" style={{ top }}>
                  <button type="button" aria-expanded={r.open} onClick={() => toggleGroup(r.group, !r.open)} disabled={needle !== ''}>
                    {r.open ? <IconChevron /> : <IconChevronRight />}
                    <strong>{r.group.title}</strong>
                    <small>{r.group.subtitle} · {r.count}</small>
                  </button>
                </li>
              );
            }
            const on = chosen.has(r.signal.id);
            return (
              <li key={r.signal.id} className="bw-tree-signal" style={{ top }}>
                <label>
                  <input type="checkbox" checked={on} disabled={!on && !canAdd} onChange={(e) => onToggle(r.group, r.signal, e.target.checked)} />
                  <span><strong>{r.signal.name}</strong>{r.signal.unit ? <small> [{r.signal.unit}]</small> : null}</span>
                  <small className="bw-tree-where">{r.group.title}</small>
                </label>
              </li>
            );
          })}
        </ul>
        {rows.length === 0 && <p className="bw-empty">{total === 0 ? 'No signals yet.' : `No signal matches “${search}”.`}</p>}
      </div>
    </div>
  );
}
