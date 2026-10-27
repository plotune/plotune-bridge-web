import { useStore, useWorkspace } from '../state/context';
import { Badge } from './Badge';
import { Panel } from './Panel';

const COLUMNS: { key: string; label: string; hint: string }[] = [
  { key: 'rxReceived', label: 'Received', hint: 'Frames the device received from the bus while capturing.' },
  { key: 'rxForwarded', label: 'Delivered', hint: 'Frames the device handed to this connection.' },
  { key: 'rxDropped', label: 'Dropped', hint: 'Frames the device received but could not deliver.' },
  { key: 'rxOverflow', label: 'Buffer full', hint: 'Dropped because the device buffer was full.' },
  { key: 'txSent', label: 'Sent', hint: 'Frames the device put on the bus.' },
  { key: 'txFailed', label: 'Send failed', hint: 'Frames accepted but not sent.' },
  { key: 'busErrors', label: 'Bus errors', hint: 'Bus errors the channel has seen.' },
];

export function StatsPanel() {
  const store = useStore();
  const state = useWorkspace();
  const dropped = state.statistics.reduce((n, s) => n + s.rxDropped, 0);
  const status = dropped > 0 || state.lostBatches > 0 ? <Badge tone="warn">Frames missing</Badge> : <Badge tone="good">No frames missing</Badge>;
  return (
    <Panel
      id="stats"
      title="Statistics"
      status={status}
      actions={
        <button type="button" className="bw-button bw-small" onClick={() => void store.resetStatistics()} disabled={state.busy || state.phase !== 'connected'}>
          Reset counters
        </button>
      }
    >
      <div className="bw-table-wrap" role="region" aria-label="Statistics by channel" tabIndex={0}>
        <table className="bw-table" data-testid="stats-table">
          <thead>
            <tr>
              <th scope="col">Channel</th>
              {COLUMNS.map((c) => (
                <th scope="col" key={c.key} title={c.hint}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.statistics.map((s) => (
              <tr key={s.channel} data-channel={s.channel}>
                <th scope="row">CAN{s.channel}</th>
                {COLUMNS.map((c) => {
                  const value = s[c.key as keyof typeof s] as number;
                  const warn = (c.key === 'rxDropped' || c.key === 'rxOverflow' || c.key === 'txFailed' || c.key === 'busErrors') && value > 0;
                  return (
                    <td key={c.key} className={`bw-mono ${warn ? 'bw-text-warn' : ''}`} data-col={c.key}>
                      {value.toLocaleString()}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="bw-fine">Counts are totals kept by the device since it started or since you last reset them, including time when no page was connected.</p>
      <p className="bw-fine" data-testid="transit-line">
        Lost in transit (between device and this page): {state.lostBatches.toLocaleString()} {state.lostBatches === 1 ? 'batch' : 'batches'}. Frames reported dropped in the trace:{' '}
        {Object.values(state.droppedReported).reduce((a, b) => a + b, 0).toLocaleString()}.
      </p>
    </Panel>
  );
}
