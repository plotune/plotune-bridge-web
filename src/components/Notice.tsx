import { useEffect, useRef, type ReactNode } from 'react';
import type { Notice as NoticeData } from '../transport/notices';
import { IconAlert, IconInfo } from './icons';

/**
 * Only take focus from body or the connection UI. Never yank it from a field the user is typing in,
 * from another panel, or from an open dialog/menu — a re-render with a fresh notice object must not
 * pull focus back to the card (BWEB-042 rev 1 / O3).
 */
function focusMayMove(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  if (active instanceof HTMLElement) {
    if (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return false;
    if (active.closest('[role="dialog"], [role="menu"]')) return false;
  }
  // The add-device pane, the connecting card, the account pane and the floating notice dock.
  return !!active.closest('.bw-connect, .bw-account, .bw-connecting, .bw-add-device, .bw-dock, .bw-sign-in-card, .bw-notice');
}

export function NoticeCard({ notice, actions }: { notice: NoticeData; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef<string | null>(null);
  // BWEB-042 rev 1 / O3 (WCAG 3.3.1 / 4.1.3): a failed open/connect is already an alert, but focus
  // used to stay on body or the pane title. Put keyboard and screen-reader focus ON the failure, so
  // the recovery actions are the next Tab stops. tabIndex=-1 keeps the card out of the normal tab
  // order; informational notices stay passive and never steal focus.
  useEffect(() => {
    if (notice.severity !== 'error') { seen.current = null; return; }
    // Identity guard: consider each distinct failure only once per mount. A parent re-render that
    // passes a freshly constructed (but identical) notice object must not refocus the card, and a
    // user typing elsewhere must keep their focus.
    const key = [notice.kind, notice.title, notice.summary, notice.technical].join('|');
    if (seen.current === key) return;
    seen.current = key;
    if (!focusMayMove()) return;
    ref.current?.focus();
  }, [notice]);
  const Icon = notice.severity === 'info' ? IconInfo : IconAlert;
  return (
    <div
      ref={ref}
      className={`bw-notice bw-notice-${notice.severity}`}
      role={notice.severity === 'error' ? 'alert' : 'status'}
      data-notice={notice.kind}
      tabIndex={notice.severity === 'error' ? -1 : undefined}
    >
      <Icon className="bw-notice-icon" />
      <div className="bw-notice-body">
        <strong>{notice.title}</strong>
        <p>{notice.summary}</p>
        {notice.steps.length > 0 && (
          <ul>
            {notice.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        )}
        {notice.technical && (
          <details className="bw-details">
            <summary>Technical details</summary>
            <code>{notice.technical}</code>
          </details>
        )}
        {actions && <div className="bw-notice-actions">{actions}</div>}
      </div>
    </div>
  );
}
