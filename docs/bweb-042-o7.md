# BWEB-042 rev 1 — O7: a pending state before the plotune.net redirect

**Status:** Approved requirement; fixes one open item from `docs/ux-a11y-pass.md`.
**Base:** `origin/main` `41c1728`.
**IDs:** BWEB-042 rev 1 (primary). Open item **O7** (Doherty, Medium).

## The gap

Clicking **Sign in with Plotune** called `window.location.assign()` in the same task as the state update, so React never
painted and the browser showed a frozen page for the whole redirect. Measured on this host against the real endpoint
`https://www.plotune.net/bridge/authorize` (five probes, HTTP 404 because the probe has no PKCE/state, so this is only
the floor): **0.147 / 0.151 / 0.159 / 0.173 / 0.382 s** before the auth page even starts rendering.

## Change

| File | Change |
|---|---|
| `src/cloud/paint.ts` | `PaintScheduler`: two animation frames (a macrotask where rAF is unavailable). Injected, so tests step it by hand. |
| `src/cloud/context.tsx` | After saving the PKCE pair: set the pending state, `await paintScheduler.afterPaint()`, then redirect. `startSignIn` marks the interactive case with `takingToPlotune`, so the honest copy *"Taking you to Plotune to sign in…"* is announced only when the user asked to leave. A refused redirect (no storage/unsupported origin) returns before the pending state, and a failed/cancelled redirect clears it — never a stuck spinner. |
| `src/components/SignInPending.tsx` | The status line takes the pending message; the automatic (prompt=none) attempt keeps *"Signing you in with your Plotune account…"*. |
| `src/App.tsx` | Passes `message` through. |

## Verification

```
npx vitest run tests/bweb-042-o7.test.tsx tests/accessibility-pass.test.tsx \
                tests/first-open.test.tsx tests/sign-in.test.tsx   → 4 files, 81 tests passed
```

The O7 spec pins the ordering with an injected scheduler: the redirect has not happened while the paint step is pending,
the announced pending line is in the DOM when `redirect()` finally runs, and a refused redirect leaves the honest notice
with no pending screen.

Full suite, typecheck, build and lint are recorded in the PR body.

## Limitations

- The real plotune.net auth page's full load time cannot be measured here (Cloud dependency); only the endpoint TTFB.
- Copy-only UI change on an existing screen: no new controls, no new axe target. The pending screen's landmark and live
  region are covered by `tests/accessibility-pass.test.tsx`; the screen itself is not re-scanned by axe in this PR.
- O2 (duplicate names) was fixed separately and is not part of this PR.
