# Bridge Web real-user visual findings — U2: phone Statistics scroll cue

**Status:** Fix ready for owner review; **not merged**. One focused PR.
**Base:** `origin/main` `f9c7cb7` (O2 #78 and O7 #79 merged during the session).
**ID:** real-user finding **U2 (Medium)** from `/tmp/opencode/visual/FINDINGS.md`.
**Documentation style:** follows `docs/bweb-042-o3.md` / `docs/bweb-042-o9.md`. This is a real-user visual finding, **not** a BWEB-042 WCAG requirement item.

## Scope: one gap — the cut table has no cue

At 390×844 the Statistics `<table>` is **653 px** wide inside a ~366 px panel: ~313 px is hidden. `.bw-table-wrap` already has `overflow-x: auto` and is a labelled, focusable `role="region"` with `tabIndex={0}`, so it *is* scrollable — but the header is cut mid-word at `BUF` with no fade or scrollbar hint, so the `SENT`, `SEND FAILED` and `BUS ERRORS` columns look **absent** rather than scrollable (evidence `crop-mobile-stats.png`, `report3.json` `mobileStats`). The same cut happens in a narrow Statistics panel on a 1440 px desktop, so the fix is not phone-only.

Chromium's scrollbars are overlays here: `offsetHeight − clientHeight = 0`, so they do not reserve space and are not persistently painted (measured in PR #80's e2e run). A styled bar alone is therefore not a reliable cue.

## Change

- `src/components/StatsPanel.tsx`
  - A small `useEffect` keeps a `data-more` flag on `.bw-table-wrap`, true only while `scrollWidth − clientWidth − scrollLeft > 8` — i.e. only when columns are **actually** hidden to the right. It re-measures on `scroll`, on `ResizeObserver` and when the statistics rows change, so the cue disappears at the scroll end and never lies on a wide panel.
  - One hint line, `Scroll sideways for Sent, Send failed and Bus errors →`, naming exactly the columns the finding said looked absent. It sits outside the `<table>`, so the O9 row/header semantics are unchanged.
- `src/styles/app.css`
  - `.bw-table-wrap` gains `scrollbar-width: thin` / a styled webkit thumb (best-effort visible bar).
  - `[data-more='true']` applies a real **edge fade** via `mask-image` (an inset shadow would be painted under the opaque `td` backgrounds). The fade and the hint (`+ .bw-table-scroll-hint`) disappear once `data-more` is false.

No contract, Cloud or deployment change. No sheet edits.

## Verification (real browser + axe, both viewports)

| Check | Level | What it proves |
|---|---|---|
| `tests/bweb-042-u2.test.tsx` | L2 component + CSS contract | the wrap is a labelled, keyboard-focusable region; the hint exists and names the hidden columns; the CSS declares the thin bar, the `[data-more]` hint rule and the edge fade |
| `e2e/bweb-042-u2.spec.ts` | L3, real Chromium 390×844 | the table really overflows, `data-more='true'`, the hint is visible, `mask-image` is a gradient, `scrollbar-width: thin`, no page overflow; **scrolling to the end clears `data-more` and hides the hint** (the cue is truthful); screenshot |
| `e2e/bweb-042-u2.spec.ts` | L3, real Chromium 1440×900 | the same cue is present in a narrow desktop Statistics panel; screenshot |
| `e2e/bweb-042-u2.spec.ts` | L3, axe `wcag2a/2aa/21a/21aa/22aa` | 0 violations on the Statistics panel at both viewports |

Commands and results are in the PR body. The `data-more` flag is the part the L2 test cannot prove (jsdom has no layout); the real-browser scroll-to-end assertion does.

## Limitations

- The `data-more` measurement uses an 8 px tolerance, so the cue clears just before the very last pixel of scroll. Harmless.
- `mask-image` fades the rightmost 28 px of visible content including the header text; that is the intended edge-fade affordance, and it is removed at the scroll end.
- Verified in Chromium 141.0.7390.37 only, at 390×844 and 1440×900. No other browser, screen reader, zoom or 200% reflow. axe is automated WCAG 2.2 AA only; the wrap already was keyboard-scrollable and that is unchanged.
- The running 4174 preview and the deployed page are not changed by this PR: **owner merge + Pages deployment** is the next step. No merge performed.
