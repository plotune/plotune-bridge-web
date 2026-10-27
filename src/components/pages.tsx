import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_DIAG, toIsoTpConfig, toXcpConfig, type DiagSettings } from '../diagnostics/settings';
import { IsoTpLink } from '../diagnostics/isotp';
import { UdsClient } from '../diagnostics/uds';
import { XcpClient } from '../diagnostics/xcp';
import { readStored, writeStored } from '../lib/storage';
import { useStore, useWorkspace } from '../state/context';
import { ChannelsPanel } from './ChannelsPanel';
import { DevicePanel } from './DevicePanel';
import type { LogEntry } from './diagnostics';
import { LinkPanel, UdsPanel, XcpPanel } from './DiagnosticsPanels';
import { StatsPanel } from './StatsPanel';
import { TracePanel } from './TracePanel';
import { TransmitPanel } from './TransmitPanel';
import { IconPanels } from './icons';

export type PageId = 'capture' | 'diagnostics' | 'device';

export interface PanelDef {
  id: string;
  label: string;
  render(): ReactNode;
  wide?: boolean;
}

function useHidden(page: PageId): [Set<string>, (id: string, visible: boolean) => void] {
  const key = `bw.hidden.${page}`;
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(readStored(key) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string, visible: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(id);
      else next.add(id);
      writeStored(key, JSON.stringify([...next]));
      return next;
    });
  return [hidden, toggle];
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

export function Dashboard({ page, panels, head }: { page: PageId; panels: PanelDef[]; head: (menu: ReactNode) => ReactNode }) {
  const [hidden, toggle] = useHidden(page);
  return (
    <>
      {head(<PanelsMenu panels={panels} hidden={hidden} onToggle={toggle} />)}
      <div className="bw-grid" data-page={page}>
        {panels.filter((p) => !hidden.has(p.id)).map((p) => (
          <div key={p.id} className={p.wide ? 'bw-span-2' : ''}>{p.render()}</div>
        ))}
        {panels.every((p) => hidden.has(p.id)) && <p className="bw-empty">All panels are hidden. Use Panels to show them again.</p>}
      </div>
    </>
  );
}

export const capturePanels: PanelDef[] = [
  { id: 'channels', label: 'Channels', wide: true, render: () => <ChannelsPanel /> },
  { id: 'stats', label: 'Statistics', wide: true, render: () => <StatsPanel /> },
  { id: 'trace', label: 'Trace', wide: true, render: () => <TracePanel /> },
  { id: 'transmit', label: 'Send frame', wide: true, render: () => <TransmitPanel /> },
];

export const devicePanels: PanelDef[] = [{ id: 'device', label: 'Device', render: () => <DevicePanel /> }];

const DIAG_KEY = 'bw.diagnostics';

export function useDiagnostics() {
  const store = useStore();
  const state = useWorkspace();
  const [settings, setSettings] = useState<DiagSettings>(() => {
    try {
      return { ...DEFAULT_DIAG, ...(JSON.parse(readStored(DIAG_KEY) ?? '{}') as Partial<DiagSettings>) };
    } catch {
      return DEFAULT_DIAG;
    }
  });
  const [udsLog, setUdsLog] = useState<LogEntry[]>([]);
  const [xcpLog, setXcpLog] = useState<LogEntry[]>([]);
  const channel = state.channels.some((c) => c.channel === settings.channel) ? settings.channel : (state.channels[0]?.channel ?? 1);
  const effective = useMemo(() => ({ ...settings, channel }), [settings, channel]);

  const io = useMemo(() => store.diagnosticsIo(), [store]);
  const iso = useMemo(() => toIsoTpConfig(effective), [effective]);
  const xcpCfg = useMemo(() => toXcpConfig(effective), [effective]);
  const link = useMemo(() => (iso.error === undefined ? new IsoTpLink(io, iso.value) : null), [io, iso]);
  const uds = useMemo(() => (link ? new UdsClient(link, { p2Ms: effective.timeoutMs, p2StarMs: 5000, maxPending: 20 }) : null), [link, effective.timeoutMs]);
  const xcp = useMemo(() => (xcpCfg.error === undefined ? new XcpClient(io, xcpCfg.value) : null), [io, xcpCfg]);

  useEffect(() => {
    link?.start();
    return () => link?.stop();
  }, [link]);

  const change = (patch: Partial<DiagSettings>) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeStored(DIAG_KEY, JSON.stringify(next));
      return next;
    });

  const errors = [iso.error, xcpCfg.error].filter((e): e is string => e !== undefined);
  return { settings: effective, change, errors, uds, xcp, udsLog, xcpLog, addUdsLog: (e: LogEntry) => setUdsLog((l) => [e, ...l].slice(0, 50)), addXcpLog: (e: LogEntry) => setXcpLog((l) => [e, ...l].slice(0, 50)) };
}

export function diagnosticsPanels(d: ReturnType<typeof useDiagnostics>): PanelDef[] {
  return [
    { id: 'link', label: 'Diagnostic link', render: () => <LinkPanel settings={d.settings} onChange={d.change} errors={d.errors} /> },
    { id: 'uds', label: 'Diagnostic requests', wide: true, render: () => <UdsPanel uds={d.uds} settings={d.settings} log={d.udsLog} onLog={d.addUdsLog} /> },
    { id: 'xcp', label: 'Calibration (XCP)', wide: true, render: () => <XcpPanel xcp={d.xcp} settings={d.settings} log={d.xcpLog} onLog={d.addXcpLog} /> },
  ];
}
