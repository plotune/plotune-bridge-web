import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatRelativeNs } from '../lib/bytes';
import { useDbcAssignments, useDbcRegistry } from '../dbc/context';
import type { DbcMessage, DecodedSignal } from '../dbc/types';
import type { CanFrame } from '../protocol/types';
import { NO_FILTER, filterActive, formatTraceData, formatTraceId, rowMatches, type Radix, type TraceFilter } from '../lib/traceFilter';
import { useHub, useHubState } from '../state/context';
import type { TraceRow } from '../state/trace';
import { IconClear } from './icons';
import { Badge } from './Badge';
import { Panel } from './Panel';

const ROW_HEIGHT = 26;
const OVERSCAN = 12;

/** A decoded value as people read it: up to 7 significant digits, its unit, and the label the database gives it. */
export function formatSignalValue(signal: DecodedSignal): string {
  const value = Number.isInteger(signal.value) ? String(signal.value) : String(Number(signal.value.toPrecision(7)));
  return `${value}${signal.unit ? ` ${signal.unit}` : ''}${signal.label ? ` (${signal.label})` : ''}`;
}

interface RowExtras {
  /** True when a database is loaded for any channel, so every row reserves the Name column. */
  named: boolean;
  message?: DbcMessage;
  expanded: boolean;
  onToggle(key: number): void;
  signal?: DecodedSignal;
}

const Row = memo(function Row({ row, originNs, top, showDevice, radix, named, message, expanded, onToggle, signal }: { row: TraceRow; originNs: bigint | null; top: number; showDevice: boolean; radix: Radix } & RowExtras) {
  const style = { top };
  if (row.kind === 'frame' && signal) {
    return (
      <div className="bw-trace-row bw-trace-signal" style={style} role="row" data-signal={signal.name}>
        <span role="cell" className="bw-c-time" />
        {showDevice && <span role="cell" className="bw-c-dev" />}
        <span role="cell" className="bw-c-ch" />
        <span role="cell" className="bw-c-id" />
        {named && <span role="cell" className="bw-c-name bw-signal-name">{signal.name}</span>}
        <span role="cell" className="bw-c-type" />
        <span role="cell" className="bw-c-dir" />
        <span role="cell" className="bw-c-dlc" />
        <span role="cell" className="bw-mono bw-c-data">{formatSignalValue(signal)}</span>
      </div>
    );
  }
  if (row.kind === 'frame') {
    const f = row.frame;
    return (
      <div className={`bw-trace-row bw-ch-${f.channel} bw-dir-${f.direction}`} style={style} role="row" data-channel={f.channel} data-direction={f.direction}>
        <span role="cell" className="bw-mono bw-c-time">{formatRelativeNs(f.timestampNs, row.originNs ?? originNs ?? f.timestampNs)}</span>
        {showDevice && <span role="cell" className="bw-c-dev">{row.device}</span>}
        <span role="cell" className="bw-c-ch"><span className="bw-chip">CAN{f.channel}</span></span>
        <span role="cell" className="bw-mono bw-c-id">{formatTraceId(f.id, f.extended, radix)}</span>
        {named && (
          <span role="cell" className="bw-c-name">
            {message ? (
              <button type="button" className="bw-expander" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} the signals of ${message.name}`} onClick={() => onToggle(row.key)} disabled={f.rtr || message.signals.length === 0}>
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {message.name}
              </button>
            ) : null}
          </span>
        )}
        <span role="cell" className="bw-c-type">{f.extended ? 'Ext' : 'Std'} {f.rtr ? 'Remote' : 'Data'}</span>
        <span role="cell" className="bw-c-dir">{f.direction === 'rx' ? 'Rx' : 'Tx'}</span>
        <span role="cell" className="bw-mono bw-c-dlc">{f.dlc}</span>
        <span role="cell" className="bw-mono bw-c-data">{f.rtr ? `remote request for ${f.dlc} bytes` : formatTraceData(f.data, radix)}</span>
      </div>
    );
  }
  if (row.kind === 'drop') {
    return (
      <div className="bw-trace-row bw-trace-marker bw-trace-drop" style={style} role="row" data-marker="drop" data-channel={row.channel}>
        <span role="cell" className="bw-marker-text">
          {row.device ? `${row.device} · ` : ''}CAN{row.channel}: the device dropped {row.count.toLocaleString()} {row.count === 1 ? 'frame' : 'frames'} (its buffer was full). Reported here; the exact position is not known.
        </span>
      </div>
    );
  }
  if (row.kind === 'gap') {
    return (
      <div className="bw-trace-row bw-trace-marker bw-trace-drop" style={style} role="row" data-marker="gap">
        <span role="cell" className="bw-marker-text">{row.device ? `${row.device}: ` : ''}Lost in transit: {row.batches} {row.batches === 1 ? 'batch' : 'batches'} of frames did not arrive from the device.</span>
      </div>
    );
  }
  return (
    <div className="bw-trace-row bw-trace-marker bw-trace-session" style={style} role="row" data-marker="session">
      <span role="cell" className="bw-marker-text">{row.device ? `${row.device}: ` : ''}{row.text}</span>
    </div>
  );
});

export function TracePanel() {
  const hub = useHub();
  const { slots, traceView } = useHubState();
  const trace = hub.traceBuffer();
  const multi = slots.length > 1;
  const shown = multi && traceView !== 'all' ? slots.filter((s) => s.id === traceView) : slots;
  const shownStates = shown.map((s) => s.store.getState());
  const state = {
    capturing: shownStates.some((s) => s.capturing),
    lostBatches: shownStates.reduce((n, s) => n + s.lostBatches, 0),
    droppedReported: Object.fromEntries(shownStates.flatMap((s, i) => Object.entries(s.droppedReported).map(([ch, n]) => [`${i}:${ch}`, n]))) as Record<string, number>,
    traceVersion: trace.version,
  };
  const showDevice = multi && traceView === 'all';
  const channelNumbers = [...new Set(slots.flatMap((s) => s.store.getState().channels.map((c) => c.channel)))].sort((a, b) => a - b);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(360);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState<TraceFilter>(NO_FILTER);
  const [radix, setRadix] = useState<Radix>('hex');
  const programmatic = useRef(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewport(el.clientHeight || 360));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (follow && el) {
      programmatic.current = true;
      el.scrollTop = el.scrollHeight;
      setScrollTop(el.scrollTop);
    }
  }, [state.traceVersion, follow]);

  const active = filterActive(filter);
  const registry = useDbcRegistry();
  const assignments = useDbcAssignments();
  const named = assignments.length > 0;
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const toggle = (key: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  // Names for the filter come from the loaded databases; the registry caches them per message.
  const namesOf = useMemo(
    () => (frame: CanFrame): string => registry.searchText(frame.channel, frame.id, frame.extended),
    // A new assignment changes what a frame's names are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, assignments],
  );
  // The rows to show: those that pass the filter, each followed by its decoded signals when expanded.
  // With no filter and nothing expanded the buffer is shown as it is.
  const entries = useMemo(() => {
    if (!active && expanded.size === 0) return null;
    const out: { index: number; signal?: DecodedSignal }[] = [];
    for (let i = 0; i < trace.length; i += 1) {
      const row = trace.at(i);
      if (!rowMatches(row, filter, namesOf)) continue;
      out.push({ index: i });
      if (row.kind === 'frame' && expanded.has(row.key) && !row.frame.rtr) {
        const decoded = registry.decode(row.frame.channel, row.frame.id, row.frame.extended, row.frame.data);
        for (const signal of decoded?.signals ?? []) out.push({ index: i, signal });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, filter, expanded, namesOf, state.traceVersion, trace]);
  const total = entries ? entries.length : trace.length;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const rows: React.ReactNode[] = [];
  for (let i = first; i < last; i += 1) {
    const entry = entries ? entries[i] : { index: i };
    const row = trace.at(entry.index);
    const message = row.kind === 'frame' ? registry.message(row.frame.channel, row.frame.id, row.frame.extended) : undefined;
    rows.push(
      <Row
        key={entry.signal ? `${row.key}-${entry.signal.name}` : row.key}
        row={row}
        originNs={trace.originNs}
        top={i * ROW_HEIGHT}
        showDevice={showDevice}
        radix={radix}
        named={named}
        message={message}
        expanded={row.kind === 'frame' && expanded.has(row.key)}
        onToggle={toggle}
        signal={entry.signal}
      />,
    );
  }

  const frames = trace.frameCount;
  const shownFrames = entries ? entries.filter((e) => !e.signal && trace.at(e.index).kind === 'frame').length : frames;
  const droppedTotal = Object.values(state.droppedReported).reduce((a, b) => a + b, 0);
  return (
    <Panel
      id="trace"
      title="Trace"
      className="bw-panel-trace"
      status={
        <>
          <span data-testid="trace-count">{state.capturing ? 'Capturing · ' : 'Stopped · '}{frames.toLocaleString()} {frames === 1 ? 'frame' : 'frames'}{active ? ` · ${shownFrames.toLocaleString()} shown` : ''}{trace.evicted > 0 ? ` · ${trace.evicted.toLocaleString()} older rows scrolled out of this view` : ''}</span>
          {(droppedTotal > 0 || state.lostBatches > 0) && (
            <>
              {' '}
              <Badge tone="warn" title="The device or the connection lost frames. Markers in the trace show where this was reported.">
                {droppedTotal > 0 ? `${droppedTotal.toLocaleString()} frames dropped` : `${state.lostBatches} batches lost`}
              </Badge>
            </>
          )}
        </>
      }
      actions={
        <>
          {multi && (
            <label className="bw-inline-check">
              Show
              <select value={traceView} onChange={(e) => hub.setTraceView(e.target.value)} aria-label="Trace source">
                <option value="all">All devices</option>
                {slots.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
          )}
          <label className="bw-inline-check">
            Numbers
            <select value={radix} onChange={(e) => setRadix(e.target.value as Radix)} aria-label="Number format">
              <option value="hex">Hex</option>
              <option value="dec">Decimal</option>
            </select>
          </label>
          <label className="bw-inline-check">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
          </label>
          <button type="button" className="bw-button bw-small" onClick={() => hub.clearTraces()} disabled={trace.length === 0}>
            <IconClear /> Clear
          </button>
        </>
      }
    >
      <div className="bw-trace-filter" role="search" aria-label="Filter the trace">
        <input
          type="search"
          value={filter.text}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
          placeholder={named ? 'Filter by ID, data or name (e.g. 7E8, EngineSpeed)' : 'Filter by ID or data (e.g. 7E8, 22 F1)'}
          aria-label={named ? 'Filter by ID, data or name' : 'Filter by ID or data'}
        />
        <select value={filter.channel ?? ''} onChange={(e) => setFilter({ ...filter, channel: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Filter by channel">
          <option value="">All channels</option>
          {channelNumbers.map((n) => (
            <option key={n} value={n}>CAN{n}</option>
          ))}
        </select>
        <select value={filter.direction ?? ''} onChange={(e) => setFilter({ ...filter, direction: e.target.value === '' ? null : (e.target.value as 'rx' | 'tx') })} aria-label="Filter by direction">
          <option value="">Rx and Tx</option>
          <option value="rx">Rx only</option>
          <option value="tx">Tx only</option>
        </select>
        {active && (
          <button type="button" className="bw-button bw-small" onClick={() => setFilter(NO_FILTER)}>
            Clear filter
          </button>
        )}
      </div>
      {showDevice && (
        <p className="bw-trace-note" data-testid="merge-note">
          Rows are in the order they arrived here. Each device's time is relative to its own first frame; device clocks are not synchronised.
        </p>
      )}
      <div className={`bw-trace ${showDevice ? 'has-device' : ''} ${named ? 'has-name' : ''}`} role="table" aria-label="Captured frames" aria-rowcount={total}>
        <div role="rowgroup">
          <div className="bw-trace-head" role="row">
            <span role="columnheader" className="bw-c-time">Time (s)</span>
            {showDevice && <span role="columnheader" className="bw-c-dev">Device</span>}
            <span role="columnheader" className="bw-c-ch">Channel</span>
            <span role="columnheader" className="bw-c-id">ID ({radix})</span>
            {named && <span role="columnheader" className="bw-c-name">Name</span>}
            <span role="columnheader" className="bw-c-type">Type</span>
            <span role="columnheader" className="bw-c-dir">Dir</span>
            <span role="columnheader" className="bw-c-dlc">Len</span>
            <span role="columnheader" className="bw-c-data">Data ({radix})</span>
          </div>
        </div>
        <div
          ref={scroller}
          className="bw-trace-scroll"
          role="rowgroup"
          aria-label="Trace rows"
          data-testid="trace-scroll"
          onScroll={(e) => {
            const el = e.currentTarget;
            setScrollTop(el.scrollTop);
            if (programmatic.current) {
              programmatic.current = false;
              return;
            }
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 2;
            setFollow(atBottom);
          }}
          tabIndex={0}
        >
          <div className="bw-trace-canvas" style={{ height: total * ROW_HEIGHT }}>
            {rows}
          </div>
        </div>
        {active && frames > 0 && shownFrames === 0 && <p className="bw-empty bw-trace-empty">No frames match this filter.</p>}
        {frames === 0 && <p className="bw-empty bw-trace-empty">{state.capturing ? 'Waiting for frames…' : slots.length === 0 ? 'No frames yet. Add a device when you’re ready to capture.' : 'No frames yet. Set a bit rate on a channel you want to use, then choose Start capture.'}</p>}
      </div>
    </Panel>
  );
}
