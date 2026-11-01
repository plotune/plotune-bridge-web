import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, ratioForDrag, ratioForKey } from '../layout/split';

/**
 * The edge between the Trace and the panels under it. Drag it, or focus it and use the arrow keys (Home and End for the limits,
 * Enter to go back to the default). Every panel keeps its size otherwise; only this one row changes.
 */
export function TraceSplitter({ ratio, onChange, reference }: { ratio: number | null; onChange: (ratio: number | null) => void; reference: () => number }) {
  const start = useRef<{ y: number; ratio: number } | null>(null);
  const current = ratio ?? SPLIT_DEFAULT;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = ratioForKey(current, event.key);
    if (next === null) return;
    event.preventDefault();
    onChange(next === 'reset' ? null : next);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    start.current = { y: event.clientY, ratio: current };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current) onChange(ratioForDrag(start.current.ratio, event.clientY - start.current.y, reference()));
  };
  return (
    <div
      className="bw-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the Trace. Arrow keys change its height, Home and End go to the limits, Enter resets."
      aria-valuemin={Math.round(SPLIT_MIN * 100)}
      aria-valuemax={Math.round(SPLIT_MAX * 100)}
      aria-valuenow={Math.round(current * 100)}
      aria-valuetext={`Trace takes ${Math.round(current * 100)} percent`}
      tabIndex={0}
      data-testid="trace-splitter"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onDoubleClick={() => onChange(null)}
    >
      <span className="bw-splitter-grip" aria-hidden="true" />
    </div>
  );
}
