import { useEffect } from 'react';
import { useCloud } from '../cloud/context';
import { Modal } from '../workspace/ui';
import { useDiag } from '../workspace/diagnostics';
import { StoreProvider, useHub, useHubState } from '../state/context';
import { parseRemoteTarget } from '../transport/remote';
import { ChannelsBody } from './ChannelsPanel';
import { DeviceBody } from './DevicePanel';
import { LinkBody } from './DiagnosticsPanels';

/** The link settings follow the selected device, so the dialog selects the device it was opened for. */
function Link() {
  const d = useDiag();
  return <LinkBody settings={d.settings} onChange={d.change} errors={d.errors} />;
}

/**
 * Everything that configures one device, in one place: its connection, its channels and the diagnostic link. Configuration is not a
 * panel on a canvas, so two Bridges never have to share a panel that can show only one of them.
 */
export function DeviceSettings({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const hub = useHub();
  const cloud = useCloud();
  const { slots, activeId } = useHubState();
  const found = slots.find((s) => s.id === deviceId);
  // The diagnostic link is a setting of the page, so it can be edited before any device is added.
  const slot = found ?? hub.active;
  useEffect(() => {
    if (found && activeId !== found.id) hub.select(found.id);
  }, [found, activeId, hub]);
  const remote = parseRemoteTarget(slot.store.getState().target);
  const cloudName = remote ? cloud.devices.find((d) => d.deviceUuid === remote.deviceUuid)?.deviceId : undefined;
  return (
    <Modal title={found ? `${found.label} settings` : 'Diagnostic link'} onClose={onClose} wide>
      <StoreProvider store={slot.store}>
        {found && cloudName && <p className="bw-fine">{cloudName} · paired to your Plotune project</p>}
        {found && (
          <>
            <section className="bw-settings-section" aria-label="Channels">
              <h3>Channels</h3>
              <ChannelsBody />
            </section>
            <section className="bw-settings-section" aria-label="Device">
              <h3>Device</h3>
              <DeviceBody />
            </section>
          </>
        )}
        <section className="bw-settings-section" aria-label="Diagnostic link">
          {found && <h3>Diagnostic link</h3>}
          {!found || activeId === slot.id ? <Link /> : <p className="bw-fine">Selecting this device…</p>}
        </section>
      </StoreProvider>
    </Modal>
  );
}
