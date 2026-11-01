import { useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Messages about the connection or the account float over the workspace instead of sitting in the page flow, so a
 * message appearing never pushes or squeezes the panels and never moves what you were looking at. The card can be
 * hidden; it then shrinks to a small chip in the same corner. It does not take focus. Each message mounts its own
 * dock, so a new message always starts open.
 */
export function NoticeDock({ label, children }: { label: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !hidden) {
      event.stopPropagation();
      setHidden(true);
    }
  };
  return (
    <div className="bw-dock" data-testid="notice-dock" onKeyDown={onKeyDown}>
      <div className="bw-dock-card" hidden={hidden}>
        <button type="button" className="bw-dock-close bw-icon-button" aria-label={`Hide this message: ${label}`} title="Hide (Esc)" onClick={() => setHidden(true)}>
          <span aria-hidden="true">×</span>
        </button>
        {children}
      </div>
      {hidden && (
        <button type="button" className="bw-dock-chip" onClick={() => setHidden(false)} aria-label={`Show the message: ${label}`}>
          {label}
        </button>
      )}
    </div>
  );
}
