import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toIsoTpConfig, toXcpConfig, type DiagSettings } from '../diagnostics/settings';
import { IsoTpLink } from '../diagnostics/isotp';
import { UdsClient } from '../diagnostics/uds';
import { XcpClient } from '../diagnostics/xcp';
import { useHub, useHubState, useStore, useWorkspace } from '../state/context';
import { ChannelsPanel } from './ChannelsPanel';
import { DevicePanel } from './DevicePanel';
import type { LogEntry } from './diagnostics';
import { LinkPanel, UdsPanel, XcpPanel } from './DiagnosticsPanels';
import { StatsPanel } from './StatsPanel';
import { TracePanel } from './TracePanel';
import { TransmitPanel } from './TransmitPanel';
import { IconPanels } from './icons';

import { acceptsAny, type DataKind } from '../core/model';
import type { PageId } from '../state/persistence';
export type { PageId } from '../state/persistence';

export interface PanelDef {
  id: string;
  label: string;
  render(): ReactNode;
  wide?: boolean;
  /** The data kinds this panel can show. Panels that need a specific device protocol say so here. */
  accepts: readonly DataKind[] | 'any';
}

/** The panels worth showing for a source that provides `provides`. With no source, every panel stays available. */
export function panelsFor(panels: PanelDef[], provides: readonly DataKind[] | null): PanelDef[] {
  return provides === null ? panels : panels.filter((p) => acceptsAny(p.accepts, provides));
}

function useHidden(page: PageId): [Set<string>, (id: string, visible: boolean) => void] {
  const hub = useHub();
  const { hidden } = useHubState();
  return [new Set(hidden[page]), (id, visible) => hub.setPanelVisible(page, id, visible)];
}

export function PanelsMenu({ panels, hidden, onToggle }: { panels: PanelDef[]; hidden: Set<string>; onToggle(id: string, visible: boolean): void }) {
  return (
    <details className="bw-menu">
      <summary className="bw-button bw-small">
        <IconPanels /> Panels
      </summary>
      <div className="bw-menu-body" role="group" aria-label="Show panels">
        {panels.map((p) => (
          <label key={p.id} className="bw-menu-item">
            <input type="checkbox" checked={!hidden.has(p.id)} onChange={(e) => onToggle(p.id, e.target.checked)} /> {p.label}
          </label>
        ))}
      </div>
    </details>
  );
}

export function Dashboard({ page, panels: all, head, provides = null }: { page: PageId; panels: PanelDef[]; head: (menu: ReactNode) => ReactNode; provides?: readonly DataKind[] | null }) {
  const [hidden, toggle] = useHidden(page);
  const panels = panelsFor(all, provides);
  return (
    <>
      {head(<PanelsMenu panels={panels} hidden={hidden} onToggle={toggle} />)}
      <div className="bw-grid" data-page={page}>
        {panels.filter((p) => !hidden.has(p.id)).map((p) => (
          <div key={p.id} className={`bw-tile-${p.id} ${p.wide ? 'bw-span-2' : ''}`}>{p.render()}</div>
        ))}
        {panels.every((p) => hidden.has(p.id)) && <p className="bw-empty">All panels are hidden. Use Panels to show them again.</p>}
      </div>
    </>
  );
}

export const capturePanels: PanelDef[] = [
  { id: 'trace', accepts: ['frames'], label: 'Trace', wide: true, render: () => <TracePanel /> },
  { id: 'channels', accepts: ['frames'], label: 'Channels', wide: true, render: () => <ChannelsPanel /> },
  { id: 'stats', accepts: ['frames'], label: 'Statistics', wide: true, render: () => <StatsPanel /> },
  { id: 'transmit', accepts: ['frames'], label: 'Send frame', wide: true, render: () => <TransmitPanel /> },
];

export const devicePanels: PanelDef[] = [{ id: 'device', accepts: 'any', label: 'Device', wide: true, render: () => <DevicePanel /> }];

export function useDiagnostics() {
  const store = useStore();
  const state = useWorkspace();
  const hub = useHub();
  const { diagnostics: settings } = useHubState();
  const [udsLog, setUdsLog] = useState<LogEntry[]>([]);
  const [xcpLog, setXcpLog] = useState<LogEntry[]>([]);
  const channel = state.channels.some((c) => c.channel === settings.channel) ? settings.channel : (state.channels[0]?.channel ?? 1);
  const effective = useMemo(() => ({ ...settings, channel }), [settings, channel]);

  const io = useMemo(() => store.diagnosticsIo(), [store]);
  const iso = useMemo(() => toIsoTpConfig(effective), [effective]);
  const xcpCfg = useMemo(() => toXcpConfig(effective), [effective]);
  const link = useMemo(() => (state.phase === 'connected' && state.sessionNumber > 0 && iso.error === undefined ? new IsoTpLink(io, iso.value) : null), [io, iso, state.phase, state.sessionNumber]);
  const uds = useMemo(() => (link ? new UdsClient(link, { p2Ms: effective.timeoutMs, p2StarMs: 5000, maxPending: 20 }) : null), [link, effective.timeoutMs]);
  const xcp = useMemo(() => (state.phase === 'connected' && state.sessionNumber > 0 && xcpCfg.error === undefined ? new XcpClient(io, xcpCfg.value) : null), [io, xcpCfg, state.phase, state.sessionNumber]);

  useEffect(() => {
    link?.start();
    return () => link?.stop();
  }, [link]);

  const change = (patch: Partial<DiagSettings>) => hub.setDiagSettings(patch);

  const errors = [iso.error, xcpCfg.error].filter((e): e is string => e !== undefined);
  return { settings: effective, change, errors, uds, xcp, udsLog, xcpLog, addUdsLog: (e: LogEntry) => setUdsLog((l) => [e, ...l].slice(0, 50)), addXcpLog: (e: LogEntry) => setXcpLog((l) => [e, ...l].slice(0, 50)) };
}

export function diagnosticsPanels(d: ReturnType<typeof useDiagnostics>): PanelDef[] {
  return [
    { id: 'link', accepts: ['frames'], label: 'Diagnostic link', render: () => <LinkPanel settings={d.settings} onChange={d.change} errors={d.errors} /> },
    { id: 'uds', accepts: ['frames'], label: 'Diagnostic requests', wide: true, render: () => <UdsPanel uds={d.uds} settings={d.settings} log={d.udsLog} onLog={d.addUdsLog} /> },
    { id: 'xcp', accepts: ['frames'], label: 'Calibration (XCP)', wide: true, render: () => <XcpPanel xcp={d.xcp} settings={d.settings} log={d.xcpLog} onLog={d.addXcpLog} /> },
  ];
}
