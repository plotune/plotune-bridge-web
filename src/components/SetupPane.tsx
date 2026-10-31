import { formatBitrate } from './ChannelsPanel';
import { useCloud } from '../cloud/context';
import { useHub, useHubState } from '../state/context';
import type { Slot } from '../state/hub';
import { MAX_DEVICES } from '../state/hub';
import { IconClose, IconPlus } from './icons';

function phaseText(phase: string): string {
  return phase === 'connected' ? 'Connected' : phase === 'connecting' ? 'Connecting…' : phase === 'closed' ? 'Disconnected' : 'Not connected';
}

function DeviceNode({ slot, active }: { slot: Slot; active: boolean }) {
  const hub = useHub();
  const cloud = useCloud();
  const { queueSettledFor } = useHubState();
  const state = slot.store.getState();
  const connected = state.phase === 'connected';
  const started = slot.remembered || state.sessionNumber > 0;
  // Queued behind the automatic reconnect of this sign-in: it is already scheduled, so no button offers to start it.
  const queued = cloud.status === 'signed-in' && hub.isAwaitingSignIn(slot) && queueSettledFor !== cloud.readSessionGeneration();
  return (
    <li className={`bw-setup-device ${active ? 'is-active' : ''}`} aria-current={active ? 'true' : undefined} data-testid={started ? 'device-chip' : `setup-${slot.id}`} data-phase={state.phase}>
      <div className="bw-setup-row">
        <button type="button" className="bw-setup-select" onClick={() => hub.select(slot.id)} aria-label={`Select ${slot.label}`}>
          <span className={`bw-led bw-led-${state.phase}`} aria-hidden="true" />
          <span className="bw-setup-name">{slot.label}</span>
        </button>
        <span className="bw-setup-state">
          {phaseText(state.phase)}
        </span>
        {(
          <button type="button" className="bw-icon-button" onClick={() => hub.removeDevice(slot.id)} aria-label={`Remove ${slot.label}`} title="Remove this device">
            <IconClose />
          </button>
        )}
      </div>
      {started && (
        <p className="bw-setup-meta bw-mono" title={state.target}>
          {state.descriptor?.deviceId ?? state.target}
        </p>
      )}
      {connected && (
        <ul className="bw-setup-channels">
          {state.channels.map((c) => (
            <li key={c.channel}>
              <span className="bw-mono">{c.name}</span>
              <span className="bw-muted">{c.bitrate === null ? 'Bit rate not set' : formatBitrate(c.bitrate)}</span>
              {c.streaming && <span className="bw-setup-tag">Capturing</span>}
            </li>
          ))}
        </ul>
      )}
      {state.actionError && active && <p className="bw-setup-error">{state.actionError}</p>}
      {started && (
        <div className="bw-setup-actions">
          {connected ? (
            <button type="button" className="bw-button bw-small" onClick={() => slot.store.disconnect()}>
              Disconnect
            </button>
          ) : (
            // The active device's notice already offers Reconnect; one entry point per action.
            // While connecting, the button would only be disabled, so it is not shown.
            !active && !queued && state.phase !== 'connecting' && state.target && (
              <button type="button" className="bw-button bw-small" onClick={() => void slot.store.connect(state.target)}>
                Reconnect
              </button>
            )
          )}
        </div>
      )}
    </li>
  );
}

/** The measurement-setup list: every device on this page, its state and channels. Selecting one points the panels at it. */
export function SetupPane() {
  const hub = useHub();
  const { slots, activeId } = useHubState();
  const connectedCount = slots.filter((s) => s.store.getState().phase === 'connected').length;
  return (
    <section className="bw-setup" aria-label="Devices">
      <div className="bw-setup-head">
        <p className="bw-nav-label">Devices</p>
        <button type="button" className="bw-icon-button" onClick={() => hub.addDevice()} disabled={slots.length >= MAX_DEVICES} aria-label="Add a device" title="Add a device">
          <IconPlus />
        </button>
      </div>
      {slots.length === 0 && <p className="bw-setup-empty">No devices added. Your workspace is ready to use offline.</p>}
      <ul className="bw-setup-list">
        {slots.map((slot) => (
          <DeviceNode key={slot.id} slot={slot} active={slot.id === activeId} />
        ))}
      </ul>
      <p className="bw-fine bw-setup-foot">{connectedCount} of {slots.length} {slots.length === 1 ? 'device' : 'devices'} connected</p>
    </section>
  );
}
