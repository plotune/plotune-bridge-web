import { useStore, useWorkspace } from '../state/context';
import { Badge } from './Badge';
import { Panel } from './Panel';

export function DevicePanel() {
  const store = useStore();
  const state = useWorkspace();
  const d = state.descriptor;
  const connected = state.phase === 'connected';
  const wall = d?.clock.wallClockNs != null ? new Date(Number(d.clock.wallClockNs / 1_000_000n)).toISOString().replace('T', ' ').replace('Z', ' UTC') : null;
  return (
    <Panel id="device" title="Device" status={connected ? <Badge tone="good">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}>
      {d ? (
        <dl className="bw-facts" data-testid="device-facts">
          <div><dt>Device</dt><dd className="bw-mono">{d.deviceId}</dd></div>
          <div><dt>Software</dt><dd className="bw-mono">{d.firmware}</dd></div>
          <div><dt>Channels</dt><dd>{d.channels.length === 1 ? '1 (CAN1)' : '2 (CAN1, CAN2)'} · classic CAN</dd></div>
          <div><dt>Address</dt><dd className="bw-mono">{state.target}</dd></div>
          <div><dt>Connection</dt><dd>Direct from this page · session {state.sessionNumber}</dd></div>
          <div>
            <dt>Device clock</dt>
            <dd>{d.clock.wallClockSynced && wall ? `Synced to wall time (${wall} when connected)` : 'Not synced to wall time. Timestamps are relative to the device clock.'}</dd>
          </div>
        </dl>
      ) : (
        <p className="bw-empty">Not connected to a device.</p>
      )}
      <div className="bw-actions">
        {connected ? (
          <button type="button" className="bw-button" onClick={() => store.disconnect()}>Disconnect</button>
        ) : (
          !state.notice && state.target && <button type="button" className="bw-button bw-primary" onClick={() => void store.connect(state.target)} disabled={state.phase === 'connecting'}>Reconnect</button>
        )}
      </div>
      {d && (
        <details className="bw-details">
          <summary>Technical details</summary>
          <code>protocol {d.contractVersion} · profile {d.profile} · session {d.sessionId} · device buffer {d.rxQueueCapacity} frames · timestamps are device-side 64-bit nanoseconds</code>
        </details>
      )}
    </Panel>
  );
}
