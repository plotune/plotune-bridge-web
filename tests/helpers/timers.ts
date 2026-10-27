import { vi } from 'vitest';

/** Advances fake time one millisecond at a time until the promise settles, then returns or throws its outcome. */
export async function settle<T>(promise: Promise<T>, maxMs = 8000): Promise<T> {
  const state: { done: boolean; failed: boolean; value?: T; error?: unknown } = { done: false, failed: false };
  promise.then(
    (value) => Object.assign(state, { done: true, value }),
    (error) => Object.assign(state, { done: true, failed: true, error }),
  );
  for (let t = 0; t < maxMs && !state.done; t += 1) await vi.advanceTimersByTimeAsync(1);
  if (!state.done) throw new Error(`promise did not settle within ${maxMs} ms of fake time`);
  if (state.failed) throw state.error;
  return state.value as T;
}
