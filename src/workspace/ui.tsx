// Small building blocks of the workspace: a modal dialog, a context menu and toasts. Kept dependency-free.
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

/** A modal dialog: Escape and the backdrop close it, Tab stays inside, and focus returns to where it was. */
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button');
    (first ?? ref.current)?.focus();
    return () => before?.focus?.();
  }, []);
  return createPortal(
    <div className="bw-modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        className={`bw-modal ${wide ? 'bw-modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
          if (e.key !== 'Tab' || !ref.current) return;
          const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
          if (items.length === 0) return;
          const first = items[0]!;
          const last = items[items.length - 1]!;
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }}
      >
        <div className="bw-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="bw-icon-button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="bw-modal-body">{children}</div>
        {footer && <div className="bw-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Asks for one line of text, for example a canvas name. */
export function NameDialog({ title, label, initial, action = 'Save', onSubmit, onClose }: { title: string; label: string; initial: string; action?: string; onSubmit: (value: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  const id = useId();
  const submit = () => { const v = value.trim(); if (v) { onSubmit(v); onClose(); } };
  return (
    <Modal title={title} onClose={onClose} footer={<><button type="button" className="bw-button" onClick={onClose}>Cancel</button><button type="button" className="bw-button bw-primary" onClick={submit} disabled={!value.trim()}>{action}</button></>}>
      <label className="bw-field" htmlFor={id}>
        <span>{label}</span>
        <input id={id} data-autofocus value={value} maxLength={48} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      </label>
    </Modal>
  );
}

export type MenuItem =
  | { label: string; hint?: string; disabled?: boolean; onSelect: () => void }
  | { heading: string }
  | { separator: true };

/** A menu opened at a screen position (a right click or a button). Arrow keys move, Enter picks, Escape closes. */
export function ContextMenu({ x, y, items, onClose, label = 'Menu' }: { x: number; y: number; items: MenuItem[]; onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
    el.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const away = (e: PointerEvent) => { if (!el.contains(e.target as Node)) onClose(); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [x, y, onClose]);
  return createPortal(
    <div
      ref={ref}
      className="bw-context-menu"
      role="menu"
      aria-label={label}
      style={pos}
      onKeyDown={(e) => {
        const buttons = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
        const i = buttons.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
        else if (e.key === 'Tab') { e.preventDefault(); onClose(); }
      }}
    >
      {items.map((item, i) => {
        if ('separator' in item) return <hr key={i} />;
        if ('heading' in item) return <div key={i} className="bw-menu-heading">{item.heading}</div>;
        return (
          <button key={i} type="button" role="menuitem" disabled={item.disabled} onClick={() => { onClose(); item.onSelect(); }}>
            <span>{item.label}</span>
            {item.hint && <small>{item.hint}</small>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** State for a context menu: `open(x, y, items)` shows it, `menu` is what to render. */
export function useContextMenu(label?: string) {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const close = useCallback(() => setState(null), []);
  const open = useCallback((x: number, y: number, items: MenuItem[]) => setState({ x, y, items }), []);
  const menu = state ? <ContextMenu x={state.x} y={state.y} items={state.items} onClose={close} label={label} /> : null;
  return { open, close, menu };
}

/* ───────────── toasts ───────────── */
export interface ToastApi { show(message: string, action?: { label: string; run: () => void }): void }
const ToastContext = createContext<ToastApi>({ show: () => undefined });
export const useToast = (): ToastApi => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; action?: { label: string; run: () => void } }[]>([]);
  const next = useRef(0);
  const api = useMemo<ToastApi>(() => ({
    show(message, action) {
      next.current += 1;
      const id = next.current;
      setToasts((t) => [...t.slice(-2), { id, message, action }]);
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 8000 : 3500);
    },
  }), []);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="bw-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="bw-toast">
            <span>{t.message}</span>
            {t.action && <button type="button" onClick={() => { t.action!.run(); setToasts((all) => all.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
