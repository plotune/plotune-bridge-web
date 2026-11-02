// What each panel type is, and how an instance of it is shown: which device's store it reads, and its settings.
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { AnalyzerPanel } from '../analysis/AnalyzerPanel';
import { RecordingsPanel } from '../analysis/RecordingsPanel';
import { UdsPanel, XcpPanel, describeLink } from '../components/DiagnosticsPanels';
import { IconAnalyze, IconDatabase, IconDiagnose, IconInfo, IconScope, IconSend, IconSettings, IconTrace, IconDevice } from '../components/icons';
import { PLOT_STORAGE_KEY, PlotPanel } from '../components/PlotPanel';
import { StatsPanel } from '../components/StatsPanel';
import { TracePanel } from '../components/TracePanel';
import { TransmitPanel } from '../components/TransmitPanel';
import { StoreProvider, useHub, useHubState, useWorkspace } from '../state/context';
import { useOpenSettings } from './context';
import { useDiag } from './diagnostics';
import type { PanelInstance, PanelType } from './project';

export interface PanelTypeDef {
  type: PanelType;
  title: string;
  description: string;
  /** Panels that act on one device. They get a source selector when more than one device is connected. */
  perDevice: boolean;
}

export const PANEL_DEFS: Record<PanelType, PanelTypeDef> = {
  trace: { type: 'trace', title: 'Trace', description: 'Live frames from every device, merged or one at a time, with filters and decoded signals.', perDevice: false },
  plot: { type: 'plot', title: 'Scope', description: 'Decoded signals as a live, rolling plot. Light and fast for watching. Send a window to the Analyzer to study it.', perDevice: false },
  stats: { type: 'stats', title: 'Statistics', description: 'Received, delivered and dropped frame counts.', perDevice: true },
  transmit: { type: 'transmit', title: 'Send frame', description: 'Compose and send CAN frames.', perDevice: true },
  uds: { type: 'uds', title: 'Diagnostic requests', description: 'UDS requests and a log of the answers.', perDevice: false },
  xcp: { type: 'xcp', title: 'Calibration (XCP)', description: 'Read and write calibration memory over XCP on CAN.', perDevice: false },
  analyzer: { type: 'analyzer', title: 'Analyzer', description: 'Study recorded data: strips, common or individual y axes, zoom, cursors, statistics and calculated signals.', perDevice: false },
  recordings: { type: 'recordings', title: 'Recordings', description: 'Recordings made in this browser. Open one in an Analyzer.', perDevice: false },
};

export const PANEL_ICONS: Record<PanelType, ComponentType<SVGProps<SVGSVGElement>>> = {
  trace: IconTrace, plot: IconScope, stats: IconInfo, transmit: IconSend, uds: IconDiagnose, xcp: IconDevice, analyzer: IconAnalyze, recordings: IconDatabase,
};

export const panelTitle = (p: PanelInstance): string => p.name ?? PANEL_DEFS[p.type].title;

/** One line naming the link the diagnostics use, with the way to change it: that lives in the device's settings, not on the canvas. */
function LinkBar() {
  const d = useDiag();
  const state = useWorkspace();
  const open = useOpenSettings();
  const channelName = state.channels.find((c) => c.channel === d.settings.channel)?.name ?? `CAN${d.settings.channel}`;
  return (
    <div className="bw-linkbar">
      <p className="bw-mono" data-testid="link-summary">{describeLink(d.settings, channelName)}</p>
      <button type="button" className="bw-icon-button" aria-label="Diagnostic link settings" title="Diagnostic link settings" onClick={() => open()}>
        <IconSettings />
      </button>
    </div>
  );
}

function DiagPanels({ type }: { type: 'uds' | 'xcp' }) {
  const d = useDiag();
  return (
    <>
      <LinkBar />
      {type === 'uds' ? <UdsPanel uds={d.uds} settings={d.settings} log={d.udsLog} onLog={d.addUdsLog} /> : <XcpPanel xcp={d.xcp} settings={d.settings} log={d.xcpLog} onLog={d.addXcpLog} />}
    </>
  );
}

function body(pid: string, p: PanelInstance): ReactNode {
  switch (p.type) {
    case 'trace': return <TracePanel />;
    case 'plot': return <PlotPanel storageKey={typeof p.config?.storageKey === 'string' ? p.config.storageKey : `bw.plot.${pid}`} />;
    case 'stats': return <StatsPanel />;
    case 'transmit': return <TransmitPanel />;
    case 'uds': case 'xcp': return <DiagPanels type={p.type} />;
    case 'analyzer': return <AnalyzerPanel pid={pid} />;
    case 'recordings': return <RecordingsPanel />;
  }
}

/** The legacy plot selection key, kept for the Plot a first visit has always had. */
export const DEFAULT_PLOT_CONFIG = { storageKey: PLOT_STORAGE_KEY };

/** One panel on a canvas, bound to the device it names (or the selected one). */
export function PanelHost({ pid, instance, onUseSelected }: { pid: string; instance: PanelInstance; onUseSelected: () => void }) {
  const hub = useHub();
  const { slots } = useHubState();
  const def = PANEL_DEFS[instance.type];
  if (!def.perDevice || !instance.device) return <>{body(pid, instance)}</>;
  const slot = slots.find((s) => s.id === instance.device);
  if (!slot) {
    return (
      <div className="bw-panel-missing" role="status">
        <p><strong>{panelTitle(instance)}</strong> reads from a device that is not in this workspace.</p>
        <button type="button" className="bw-button" onClick={onUseSelected}>Use the selected device ({hub.active.label || 'none'})</button>
      </div>
    );
  }
  return <StoreProvider store={slot.store}>{body(pid, instance)}</StoreProvider>;
}
