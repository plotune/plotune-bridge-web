// Pointer-based drag and drop for the dock. HTML5 drag and drop is not used: it cannot draw a drop zone over a panel,
// works poorly on touch and cannot be tested in jsdom. Every drag has a keyboard route (the tab menu), so this is an addition.
import type { DropZone } from './layout';

export interface DragTarget<T> {
  value: T;
  /** Draw this rectangle as the drop zone (a dock drop). */
  rect?: { left: number; top: number; width: number; height: number };
  /** Or mark this element as the target (a drop onto a plot or a strip). */
  element?: Element;
}
export interface DragCallbacks<T> {
  /** What is under the pointer, or null. */
  target(x: number, y: number): DragTarget<T> | null;
  drop(value: T, x: number, y: number): void;
}

const THRESHOLD = 6;
/** Set for one tick after a drag ends, so the click the browser sends after the pointer is released can be ignored. */
export let justDragged = false;

/** The zone of a rectangle the pointer is over: the middle adds a tab, an edge splits. The tab strip counts as the middle. */
export function zoneAt(rect: { left: number; top: number; width: number; height: number }, x: number, y: number, headerHeight = 36): DropZone {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  if (y - rect.top < headerHeight) return 'center';
  if (fx < 0.22) return 'left';
  if (fx > 0.78) return 'right';
  if (fy > 0.72 && fy > fx - 0.2) return 'bottom';
  if (fy < 0.3) return 'top';
  return 'center';
}
export function zoneRect(rect: { left: number; top: number; width: number; height: number }, zone: DropZone) {
  const { left, top, width, height } = rect;
  switch (zone) {
    case 'left': return { left, top, width: width / 2, height };
    case 'right': return { left: left + width / 2, top, width: width / 2, height };
    case 'top': return { left, top, width, height: height / 2 };
    case 'bottom': return { left, top: top + height / 2, width, height: height / 2 };
    default: return { left, top, width, height };
  }
}

export function beginDrag<T>(start: { clientX: number; clientY: number; button: number }, label: string, cb: DragCallbacks<T>): void {
  if (start.button !== 0) return;
  const sx = start.clientX;
  const sy = start.clientY;
  let active = false;
  let hot: DragTarget<T> | null = null;
  let ghost: HTMLDivElement | null = null;
  let zone: HTMLDivElement | null = null;
  let marked: Element | null = null;

  const clear = () => {
    ghost?.remove();
    zone?.remove();
    marked?.classList.remove('bw-drop-hot');
    document.body.classList.remove('bw-dragging');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
  };
  const move = (e: PointerEvent) => {
    if (!active) {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) < THRESHOLD) return;
      active = true;
      ghost = document.createElement('div');
      ghost.className = 'bw-drag-ghost';
      ghost.textContent = label;
      zone = document.createElement('div');
      zone.className = 'bw-drop-zone';
      zone.style.display = 'none';
      document.body.append(ghost, zone);
      document.body.classList.add('bw-dragging');
    }
    ghost!.style.left = `${e.clientX + 14}px`;
    ghost!.style.top = `${e.clientY + 12}px`;
    hot = cb.target(e.clientX, e.clientY);
    marked?.classList.remove('bw-drop-hot');
    marked = hot?.element ?? null;
    marked?.classList.add('bw-drop-hot');
    if (hot?.rect) Object.assign(zone!.style, { display: 'block', left: `${hot.rect.left}px`, top: `${hot.rect.top}px`, width: `${hot.rect.width}px`, height: `${hot.rect.height}px` });
    else zone!.style.display = 'none';
  };
  const finish = (drop: boolean, x: number, y: number) => {
    const was = active;
    const target = hot;
    clear();
    if (was) {
      justDragged = true;
      window.setTimeout(() => { justDragged = false; }, 0);
      if (drop && target) cb.drop(target.value, x, y);
    }
  };
  const up = (e: PointerEvent) => finish(true, e.clientX, e.clientY);
  const cancel = () => finish(false, 0, 0);
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); finish(false, 0, 0); } };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
}
