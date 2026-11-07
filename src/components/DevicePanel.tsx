import { useStore, useWorkspace } from '../state/context';
import type { ConnectionPath, LinkTraffic } from '../transport/types';
import { Badge } from './Badge';

/** Null means the first check has not finished yet. */
function pathLabel(path: ConnectionPath | null): string {
  if (path === null) return 'Checking the connection…';
  switch (path.kind) {
    case 'local-network':
      return 'Direct on your local network';
    case 'direct':
      return 'Direct, peer to peer (no Plotune relay)';
    case 'relay':
      return 'Through the Plotune relay (TURN)';
    case 'unknown':
      return 'Unknown';
  }
}

function pathDetail(path: ConnectionPath | null, traffic: LinkTraffic | null): string {
  if (path === null) return 'checking';
  switch (path.kind) {
    case 'local-network':
      return 'local network (WebSocket)';
    case 'direct':
      return `local ${path.local} ↔ remote ${path.remote} · ${path.protocol ?? 'unknown protocol'}`;
    case 'relay': {
      const bytes = traffic ? ` · sent ${traffic.bytesSent.toLocaleString('en-US')} bytes · received ${traffic.bytesReceived.toLocaleString('en-US')} bytes` : '';
      return `relay (TURN) · ${path.protocol ?? 'unknown protocol'}${bytes}`;
    }
    case 'unknown':
      return 'unknown';
  }
}

/** Connection and information of the device whose store is provided. Shown in that device's settings. */
export function DeviceBody() {
  const store = useStore();
  const state = useWorkspace();
  const d = state.descriptor;
  const connected = state.phase === 'connected';
  const relayed = state.connectionPath?.kind === 'relay';
  const wall = d?.clock.wallClockNs != null ? new Date(Number(d.clock.wallClockNs / 1_000_000n)).toISOString().replace('T', ' ').replace('Z', ' UTC') : null;
  return (
    <div className="bw-device-body">
      <p>{connected ? <Badge tone="good">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}</p>
      {d ? (
        <dl className="bw-facts" data-testid="device-facts">
          <div><dt>Device</dt><dd className="bw-mono">{d.deviceId}</dd></div>
          <div><dt>Software</dt><dd className="bw-mono">{d.firmware}</dd></div>
          <div><dt>Channels</dt><dd>{d.channels.length === 1 ? '1 (CAN1)' : '2 (CAN1, CAN2)'} · {d.canFd ? 'CAN FD' : 'classic CAN'}</dd></div>
          <div><dt>Address</dt><dd className="bw-mono">{state.target}</dd></div>
          <div>
            <dt>Connection</dt>
            <dd>
              {connected ? pathLabel(state.connectionPath) : 'Disconnected'} · session {state.sessionNumber}
              {relayed && <><br /><span className="bw-muted">Slower than a direct link; relay traffic is metered</span></>}
            </dd>
          </div>
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
          {connected && <code>connection path: {pathDetail(state.connectionPath, state.traffic)}</code>}
        </details>
      )}
    </div>
  );
}
