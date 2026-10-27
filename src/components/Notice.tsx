import type { ReactNode } from 'react';
import type { Notice as NoticeData } from '../transport/notices';
import { IconAlert, IconInfo } from './icons';

export function NoticeCard({ notice, actions }: { notice: NoticeData; actions?: ReactNode }) {
  const Icon = notice.severity === 'info' ? IconInfo : IconAlert;
  return (
    <div className={`bw-notice bw-notice-${notice.severity}`} role={notice.severity === 'error' ? 'alert' : 'status'} data-notice={notice.kind}>
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
