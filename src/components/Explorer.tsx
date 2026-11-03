import { useRef, useState } from 'react';
import { useCloud } from '../cloud/context';
import { useDbcRegistry } from '../dbc/context';
import { useAnalysis, useRecordings } from '../analysis/context';
import { useHub, useHubState } from '../state/context';
import type { Slot } from '../state/hub';
import { MAX_DEVICES } from '../state/hub';
import { parseRemoteTarget } from '../transport/remote';
import { ProjectMenu } from '../workspace/ProjectMenu';
import { useOpenSettings } from '../workspace/context';
import { useSheet } from '../workspace/WorkspaceCanvas';
import { formatBitrate } from './ChannelsPanel';
import { IconAnalyze, IconChevron, IconChevronRight, IconClose, IconPlus, IconPower, IconSettings, IconUpload } from './icons';

function phaseText(phase: string): string {
  return phase === 'connected' ? 'Connected' : phase === 'connecting' ? 'Connecting…' : phase === 'closed' ? 'Disconnected' : 'Not connected';
}

/** One device. Its tools (settings, connect or disconnect, remove) are icons that show on hover, or always on a touch screen. */
function DeviceNode({ slot, active, several, away }: { slot: Slot; active: boolean; several: boolean; away: () => void }) {
  const hub = useHub();
  const cloud = useCloud();
  const openSettings = useOpenSettings();
  const registry = useDbcRegistry();
  const { queueSettledFor } = useHubState();
  const state = slot.store.getState();
  // A remote device is named by the cloud, never by its remote:<project>/<device> address.
  const remote = parseRemoteTarget(state.target);
  const cloudName = remote ? cloud.devices.find((d) => d.deviceUuid === remote.deviceUuid)?.deviceId : undefined;
  const meta = state.descriptor?.deviceId ?? (remote ? cloudName || 'Plotune cloud device' : state.target);
  const connected = state.phase === 'connected';
  const started = slot.remembered || state.sessionNumber > 0;
  // Queued behind the automatic reconnect of this sign-in: it is already scheduled, so no button offers to start it.
  const queued = cloud.status === 'signed-in' && hub.isAwaitingSignIn(slot) && queueSettledFor !== cloud.readSessionGeneration();
  const canReconnect = !connected && started && !active && !queued && state.phase !== 'connecting' && !!state.target;
  return (
    <li className={`bw-device ${active ? 'is-active' : ''}`} aria-current={active ? 'true' : undefined} data-testid={started ? 'device-chip' : `setup-${slot.id}`} data-phase={state.phase}>
      <div className="bw-device-row">
        <button type="button" className="bw-device-select" onClick={() => { hub.select(slot.id); away(); }} aria-label={`Select ${slot.label}`}>
          <span className={`bw-led bw-led-${state.phase}`} aria-hidden="true" />
          <span className="bw-device-name">{slot.label}</span>
        </button>
        <span className="bw-device-tools">
          <button type="button" className="bw-icon-button" onClick={() => { away(); openSettings(slot.id); }} aria-label={`Settings for ${slot.label}`} title="Device settings">
            <IconSettings />
          </button>
          {connected && (
            <button type="button" className="bw-icon-button" onClick={() => slot.store.disconnect()} aria-label={`Disconnect ${slot.label}`} title="Disconnect">
              <IconPower />
            </button>
          )}
          {canReconnect && (
            <button type="button" className="bw-icon-button" onClick={() => { away(); void slot.store.connect(state.target); }} aria-label={`Reconnect ${slot.label}`} title="Reconnect">
              <IconPower />
            </button>
          )}
          <button type="button" className="bw-icon-button" onClick={() => { registry.removeSource(slot.label); hub.removeDevice(slot.id); }} aria-label={`Remove ${slot.label}`} title="Remove this device">
            <IconClose />
          </button>
        </span>
      </div>
      <p className="bw-device-meta">
        {phaseText(state.phase)}
        {started && meta ? <> · <span className={remote ? undefined : 'bw-mono'} title={remote ? undefined : state.target}>{meta}</span></> : null}
      </p>
      {connected && (
        <ul className="bw-device-channels">
          {state.channels.map((c) => (
            <li key={c.channel}>
              <span className="bw-mono">{c.name}</span>
              <span>{c.bitrate === null ? 'No bit rate' : formatBitrate(c.bitrate)}</span>
              {c.streaming && <span className="bw-device-live">Capturing</span>}
            </li>
          ))}
        </ul>
      )}
      {state.actionError && active && <p className="bw-device-error" role="alert" data-testid="action-error">{state.actionError}</p>}
      {several && <span className="sr-only bw-sr-only">{active ? 'Selected device' : ''}</span>}
    </li>
  );
}

/** Data to analyse is a source like a device: a file is opened here, and a log has settings (which database each channel uses). */
function RecordingsSection() {
  const recordings = useRecordings();
  const { open, pickFile, logSettings, store } = useAnalysis();
  const [openList, setOpenList] = useState(true);
  return (
    <div className="bw-ex-section" role="group" aria-label="Recordings">
      <div className="bw-ex-head">
        <button type="button" className="bw-ex-toggle" aria-expanded={openList} onClick={() => setOpenList(!openList)}>
          {openList ? <IconChevron /> : <IconChevronRight />}
          <span>Recordings</span>
          {recordings.length > 0 && <small>{recordings.length}</small>}
        </button>
        <button type="button" className="bw-icon-button" onClick={pickFile} aria-label="Open a file" title="Open a file to analyse (CSV, ASC, BLF, candump)">
          <IconUpload />
        </button>
      </div>
      {openList && (
        <div className="bw-ex-body">
          {recordings.length === 0 ? (
            <p className="bw-ex-empty">Open a log or CSV file, or send a window from the Scope.</p>
          ) : (
            <ul className="bw-ex-list">
              {recordings.map((r) => (
                <li key={r.id}>
                  <span title={r.name}>{r.name}<small>{r.duration.toFixed(1)} s</small></span>
                  <span className="bw-device-tools">
                    {store.logs.has(r.id) && (
                      <button type="button" className="bw-icon-button" onClick={() => logSettings(r.id)} aria-label={`Settings for ${r.name}`} title="Channels and databases of this log">
                        <IconSettings />
                      </button>
                    )}
                    <button type="button" className="bw-icon-button" onClick={() => open(r)} aria-label={`Open ${r.name} in an Analyzer`} title="Open in an Analyzer">
                      <IconAnalyze />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The left side of the workspace: what there is to work with. Devices first, then the databases that name their frames, then
 * recordings. The workspace itself (its name and its menu) sits at the top.
 */
export function Explorer({ onAway }: { onAway: () => void }) {
  const hub = useHub();
  const sheet = useSheet();
  const away = () => { if (sheet) onAway(); };
  const { slots, activeId } = useHubState();
  const connected = slots.filter((s) => s.store.getState().phase === 'connected').length;
  const add = useRef<HTMLButtonElement>(null);
  return (
    <aside className="bw-explorer" aria-label="Explorer">
      <div className="bw-explorer-scroll">
        <section className="bw-ex-section" aria-label="Devices">
          <div className="bw-ex-head">
            <span className="bw-ex-title">Devices{slots.length > 0 && <small>{connected} of {slots.length}</small>}</span>
            <button ref={add} type="button" className="bw-icon-button" onClick={() => { hub.addDevice(); away(); }} disabled={slots.length >= MAX_DEVICES} aria-label="Add a device" title="Add a device">
              <IconPlus />
            </button>
          </div>
          {slots.length === 0 ? (
            <p className="bw-ex-empty">No devices yet. Add one with + to pair a Bridge. The canvas works without one.</p>
          ) : (
            <ul className="bw-device-list">
              {slots.map((slot) => <DeviceNode key={slot.id} slot={slot} active={slot.id === activeId} several={slots.length > 1} away={away} />)}
            </ul>
          )}
        </section>
        <RecordingsSection />
      </div>
      <div className="bw-explorer-foot"><ProjectMenu /></div>
    </aside>
  );
}
