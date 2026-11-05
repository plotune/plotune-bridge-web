// A tiny scheduler for the O7 pending state: before we send the browser to plotune.net we must let React commit and the
// browser actually paint the "Taking you to Plotune to sign in…" screen. Two animation-frame ticks guarantee that one
// frame containing the new state has been painted; where rAF is unavailable (SSR, some test setups) a zero-delay task
// still yields to the browser. It is injected into CloudProvider so tests can step it deterministically, and it adds no
// arbitrary waiting: the redirect follows as soon as the paint has happened.
export interface PaintScheduler {
  /** Resolves once the browser has had a chance to paint a freshly-committed React state. */
  afterPaint(): Promise<void>;
}

export const browserPaintScheduler: PaintScheduler = {
  afterPaint: () =>
    new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      } else {
        setTimeout(resolve, 0);
      }
    }),
};
