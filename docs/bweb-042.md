# BWEB-042 rev 1 — WCAG 2.2 AA: sidebar device control target size (O10)

**Status:** Approved requirement; this PR fixes **one** concrete manual gap from the audit.
**Base:** `origin/main` `768a9a1` (PR #72 merged and deployed).
**IDs:** BWEB-042 rev 1 (primary). Related release-review context: `docs/ux-a11y-pass.md` open item **O10**.

## Scope: one gap, not all six

The audit (`docs/ux-a11y-pass.md`, "Open (6)") lists O2, O3, O7, O8, O9, O10. This PR addresses **O10 only**:

> O10 — WCAG 2.5.8 (24 px) on desktop: the sidebar device select at 1280 is 63.5x18. It fails the 24 px AA size on desktop (F1 covers phones only).

O2 (duplicate names), O3 (focus after a failure notice), O7 (pending state before redirect), O8 (bare host without a port), O9 (table semantics) are **explicitly out of scope** for this PR and remain open. Also found during the audit but **not fixed here**: workspace `ContextMenu` (the keyboard route for panel docking) drops focus to `body` on close; recorded as a follow-up finding only.

## The gap axe cannot see

The deployed WCAG 2.2 AA axe scan of the initial workspace is clean (**0 violations, 23 passes, 0 incomplete**). That state has no connected device, so the sidebar device control is not present. With two remembered devices at 1280 the control measured **131 x 22.8 px** and **105 x 22.8 px** — below the **24 x 24 CSS px** minimum of WCAG 2.5.8 (AA, WCAG 2.2).

axe still reports **0 violations**: its `target-size` rule passes the control through WCAG 2.5.8's **spacing exception** (undersized targets are allowed when a 24 px circle around each does not overlap another). Automated scanning therefore cannot see the undersized box. The fix makes the control's **own** box meet the minimum regardless of spacing.

| | Before | After |
|---|---|---|
| `.bw-device-select` box (1280) | 131 x **22.8** px / 105 x **22.8** px | >= **24 x 24** px (26 px min-height) |
| axe WCAG 2.2 AA violations | 0 (spacing exception) | 0 |
| Keyboard activation / pointer centre hit | worked, but on a sub-24 px target | works on the enlarged target |

## Change

- `src/styles/app.css`: `.bw-device-select` gains `min-height: 26px` (WCAG 2.5.8 AA minimum is 24 px; 26 px matches the 26 px device-tool buttons beside it). No new `@media (max-width: 640px)` block was added, so the existing phone 44 px rule and its regression test are untouched.
- No component, contract, Cloud or deployment change. Local-only, no plotune-cloud #120 dependency.

## Verification (what axe covers, what the manual test adds)

| Check | Level | What it proves |
|---|---|---|
| `tests/bweb-042-target-size.test.ts` | L2 (CSS contract) | the desktop rule declares a `min-height` >= 24 px |
| `e2e/bweb-042.spec.ts` — box measurement | L3, real Chromium | **manual** `getBoundingClientRect()` measurement of both controls at 1280 and 390; this is the part axe cannot see |
| `e2e/bweb-042.spec.ts` — keyboard + pointer | L3, manual | focus the control and activate with Enter; click the exact centre of its box; the selected device changes (`aria-current`) |
| `e2e/bweb-042.spec.ts` — axe `wcag2a/2aa/21a/21aa/22aa` | L3, automated | 0 violations on the initial workspace and on the two-device state; `target-size` rule confirmed to have run |

Commands and results are in the PR body. Note that axe's 0 violations are **not** the improvement; the improvement is the measured 22.8 px -> >= 24 px box plus a keyboard/pointer proof on the enlarged target.

## Limitations

- WCAG 2.5.8's spacing exception means the pre-fix control was not an automated axe violation; the requirement to enlarge it comes from the project's manual O10 audit and a direct box measurement.
- Verified in Chromium 141.0.7390.37 at 1280x900 (desktop) and 390x900 (phone) only. Other browsers, screen readers, zoom and 200% reflow were not run.
- The phone 44 px touch convention (WCAG 2.5.5, AAA / F1) still does not list `.bw-device-select`; this PR brings it to the AA 24 px minimum only. O2/O3/O7/O8/O9 remain open.
- The deployed page was not changed by this PR; owner merge + GitHub Pages deployment is the next blocker.
