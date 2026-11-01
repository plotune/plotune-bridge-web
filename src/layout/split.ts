// The share of the Capture window given to the Trace, between the Trace and the panels under it. Browser-owned convenience only.

export const SPLIT_KEY = 'bw.layout.capture.split';
export const SPLIT_MIN = 0.25;
export const SPLIT_MAX = 0.8;
export const SPLIT_DEFAULT = 0.6;
/** One arrow-key press. */
export const SPLIT_STEP = 0.05;

export const clampRatio = (r: number): number => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r));

/** A remembered ratio, or null when nothing usable is stored (then the layout is exactly the default one). */
export function parseRatio(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= SPLIT_MIN && value <= SPLIT_MAX ? value : null;
}

/** The ratio after a key on the separator; 'reset' (Enter) removes the override; null when the key does nothing here. */
export function ratioForKey(current: number, key: string): number | 'reset' | null {
  switch (key) {
    case 'ArrowUp':
    case 'ArrowLeft':
      return clampRatio(current - SPLIT_STEP);
    case 'ArrowDown':
    case 'ArrowRight':
      return clampRatio(current + SPLIT_STEP);
    case 'Home':
      return SPLIT_MIN;
    case 'End':
      return SPLIT_MAX;
    case 'Enter':
      return 'reset';
    default:
      return null;
  }
}

/** The ratio after dragging the separator by `dy` pixels, where `reference` is the height that ratio is a share of. */
export function ratioForDrag(startRatio: number, dy: number, reference: number): number {
  return clampRatio(startRatio + (reference > 0 ? dy / reference : 0));
}

/** Style variables for the grid. The plot layout sizes the Trace in viewport height (0.6 matches the old 38vh). */
export function splitVars(ratio: number | null): Record<string, string> | undefined {
  if (ratio === null) return undefined;
  return { '--row1': `${(ratio * 100).toFixed(1)}fr`, '--row2': `${((1 - ratio) * 100).toFixed(1)}fr`, '--trace-h': `${(ratio * (38 / SPLIT_DEFAULT)).toFixed(1)}vh` };
}
