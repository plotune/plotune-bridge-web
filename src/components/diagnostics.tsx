// Shared pieces of the Diagnostics page: a log of what was sent and answered, and the capture-required hint.
import { useStore, useWorkspace } from '../state/context';
import { IconAlert, IconCheck, IconInfo, IconStart } from './icons';

export interface LogEntry {
  id: number;
  at: string;
  request: string;
  tone: 'good' | 'bad' | 'warn';
  title: string;
  detail?: string;
}

let counter = 0;
export function logEntry(partial: Omit<LogEntry, 'id' | 'at'>): LogEntry {
  counter += 1;
  return { id: counter, at: new Date().toLocaleTimeString(undefined, { hour12: false }), ...partial };
}

export function DiagLog({ entries, label }: { entries: LogEntry[]; label: string }) {
  return (
    <ul className="bw-diaglog" aria-label={label} data-testid={`log-${label.toLowerCase().replace(/\W+/g, '-')}`}>
      {entries.length === 0 && <li className="bw-muted">Nothing sent yet.</li>}
      {entries.map((e) => (
        <li key={e.id} className={`is-${e.tone}`}>
          {e.tone === 'good' ? <IconCheck /> : <IconAlert />}
          <div>
            <div className="bw-diaglog-line">
              <span className="bw-mono">{e.request}</span>
              <span className="bw-muted">sent {e.at}</span>
            </div>
            <strong>{e.title}</strong>
            {e.detail && <div className="bw-mono bw-diaglog-detail">{e.detail}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Answers arrive on the receive stream, so the chosen channel must be capturing. */
export function NeedsCapture({ channel }: { channel: number }) {
  const store = useStore();
  const state = useWorkspace();
  const status = state.channels.find((c) => c.channel === channel);
  if (!status) return <p className="bw-hint"><IconInfo /> This device has no channel {channel}.</p>;
  if (status.streaming) return null;
  return (
    <div className="bw-hintbar" data-testid="needs-capture">
      <IconInfo />
      <span>
        {status.bitrate === null ? `Set a bit rate on ${status.name}, then start capture` : `Start capture on ${status.name}`} so answers can be received.
      </span>
      {status.bitrate !== null && (
        <button type="button" className="bw-button bw-small" onClick={() => void store.startCapture()} disabled={state.busy}>
          <IconStart /> Start capture
        </button>
      )}
    </div>
  );
}
