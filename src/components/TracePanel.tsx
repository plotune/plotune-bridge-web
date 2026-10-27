import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { bytesToHex, formatId, formatRelativeNs } from '../lib/bytes';
import { useStore, useWorkspace } from '../state/context';
import type { TraceRow } from '../state/trace';
import { IconClear } from './icons';
import { Badge } from './Badge';
import { Panel } from './Panel';

const ROW_HEIGHT = 26;
const OVERSCAN = 12;

const Row = memo(function Row({ row, originNs, top }: { row: TraceRow; originNs: bigint | null; top: number }) {
  const style = { top };
  if (row.kind === 'frame') {
    const f = row.frame;
    return (
      <div className={`bw-trace-row bw-ch-${f.channel} bw-dir-${f.direction}`} style={style} role="row" data-channel={f.channel} data-direction={f.direction}>
        <span role="cell" className="bw-mono bw-c-time">{formatRelativeNs(f.timestampNs, originNs ?? f.timestampNs)}</span>
        <span role="cell" className="bw-c-ch"><span className="bw-chip">CAN{f.channel}</span></span>
        <span role="cell" className="bw-mono bw-c-id">{formatId(f.id, f.extended)}</span>
        <span role="cell" className="bw-c-type">{f.extended ? 'Ext' : 'Std'} {f.rtr ? 'Remote' : 'Data'}</span>
        <span role="cell" className="bw-c-dir">{f.direction === 'rx' ? 'Rx' : 'Tx'}</span>
        <span role="cell" className="bw-mono bw-c-dlc">{f.dlc}</span>
        <span role="cell" className="bw-mono bw-c-data">{f.rtr ? `remote request for ${f.dlc} bytes` : bytesToHex(f.data, ' ').toUpperCase()}</span>
      </div>
    );
  }
  if (row.kind === 'drop') {
    return (
      <div className="bw-trace-row bw-trace-marker bw-trace-drop" style={style} role="row" data-marker="drop" data-channel={row.channel}>
        <span role="cell" className="bw-marker-text">
          CAN{row.channel}: the device dropped {row.count.toLocaleString()} {row.count === 1 ? 'frame' : 'frames'} (its buffer was full). Reported here; the exact position is not known.
        </span>
      </div>
    );
  }
  if (row.kind === 'gap') {
    return (
      <div className="bw-trace-row bw-trace-marker bw-trace-drop" style={style} role="row" data-marker="gap">
        <span role="cell" className="bw-marker-text">Lost in transit: {row.batches} {row.batches === 1 ? 'batch' : 'batches'} of frames did not arrive from the device.</span>
      </div>
    );
  }
  return (
    <div className="bw-trace-row bw-trace-marker bw-trace-session" style={style} role="row" data-marker="session">
      <span role="cell" className="bw-marker-text">{row.text}</span>
    </div>
  );
});

export function TracePanel() {
  const store = useStore();
  const state = useWorkspace();
  const trace = store.trace;
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(360);
  const [follow, setFollow] = useState(true);
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

  const total = trace.length;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const rows: React.ReactNode[] = [];
  for (let i = first; i < last; i += 1) {
    const row = trace.at(i);
    rows.push(<Row key={row.key} row={row} originNs={trace.originNs} top={i * ROW_HEIGHT} />);
  }

  const frames = total; // rows, including markers
  const droppedTotal = Object.values(state.droppedReported).reduce((a, b) => a + b, 0);
  return (
    <Panel
      id="trace"
      title="Trace"
      className="bw-panel-trace"
      status={
        <>
          <span data-testid="trace-count">{state.capturing ? 'Capturing · ' : 'Stopped · '}{frames.toLocaleString()} {frames === 1 ? 'row' : 'rows'}{trace.evicted > 0 ? ` · ${trace.evicted.toLocaleString()} older rows scrolled out of this view` : ''}</span>
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
          <label className="bw-inline-check">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
          </label>
          <button type="button" className="bw-button bw-small" onClick={() => store.clearTrace()} disabled={total === 0}>
            <IconClear /> Clear
          </button>
        </>
      }
    >
      <div className="bw-trace" role="table" aria-label="Captured frames" aria-rowcount={total}>
        <div role="rowgroup">
          <div className="bw-trace-head" role="row">
            <span role="columnheader" className="bw-c-time">Time (s)</span>
            <span role="columnheader" className="bw-c-ch">Channel</span>
            <span role="columnheader" className="bw-c-id">ID (hex)</span>
            <span role="columnheader" className="bw-c-type">Type</span>
            <span role="columnheader" className="bw-c-dir">Dir</span>
            <span role="columnheader" className="bw-c-dlc">Len</span>
            <span role="columnheader" className="bw-c-data">Data (hex)</span>
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
        {total === 0 && <p className="bw-empty bw-trace-empty">{state.capturing ? 'Waiting for frames…' : 'No frames yet. Set a bit rate on each channel, then choose Start capture.'}</p>}
      </div>
    </Panel>
  );
}
