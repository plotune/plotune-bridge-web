import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Modal } from './ui';

export interface Command { label: string; group: string; run: () => void }

/** Ctrl K: type to find a canvas, a panel or an action. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commands.filter((c) => !q || `${c.label} ${c.group}`.toLowerCase().includes(q)).slice(0, 40);
  }, [commands, query]);
  useEffect(() => { list.current?.querySelector('[aria-selected=true]')?.scrollIntoView?.({ block: 'nearest' }); }, [index]);
  const run = (c: Command | undefined) => { if (c) { onClose(); c.run(); } };
  return (
    <Modal title="Commands" onClose={onClose}>
      <input
        data-autofocus
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={results[index] ? `${listId}-${index}` : undefined}
        aria-label="Search commands"
        placeholder="Type a canvas, panel or action"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
          if (e.key === 'Enter') { e.preventDefault(); run(results[index]); }
        }}
      />
      <ul ref={list} id={listId} role="listbox" className="bw-palette-list" aria-label="Commands">
        {results.map((c, i) => (
          <li key={`${c.group}-${c.label}`} id={`${listId}-${i}`} role="option" aria-selected={i === index} onPointerDown={(e) => { e.preventDefault(); run(c); }}>
            <span>{c.label}</span>
            <small>{c.group}</small>
          </li>
        ))}
        {results.length === 0 && <li className="bw-fine" aria-disabled="true">No command matches.</li>}
      </ul>
    </Modal>
  );
}
