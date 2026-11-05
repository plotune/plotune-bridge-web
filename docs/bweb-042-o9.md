# BWEB-042 rev 1 — WCAG 2.2 AA: Trace / Statistics table semantics (O9)

**Status:** Approved requirement; this PR fixes **one** concrete gap from the audit.
**Base:** `origin/main` `d56c0b6` (PRs #72, #73 merged and deployed).
**IDs:** BWEB-042 rev 1 (primary), WCAG 1.3.1 (Info and Relationships). Open item **O9** in `docs/ux-a11y-pass.md`.

## Scope: one gap, not all six

The audit lists O2, O3, O7, O8, O9, O10. **O10 was fixed in PR #73.** This PR addresses **O9 only**:

> O9 — WCAG 1.3.1 (tables): Trace and Statistics tables: axe incomplete `aria-required-children` (row roles) and `th-has-data-cells` (header-only table when empty). Review the table semantics.

O2 (duplicate names), O3 (focus after a failure notice), O7 (pending state before redirect), O8 (bare host without a port) remain open. The `ContextMenu` focus-loss finding from PR #73 also remains a follow-up.

## The two incompletes (reproduced with axe WCAG 2.2 AA tags on `d56c0b6`)

| Rule | Node | Cause |
|---|---|---|
| `aria-required-children` (critical) | `.bw-trace-scroll` | It is `role="rowgroup"`, but its only child was `.bw-trace-canvas`, an unroled `<div>` that holds the virtualised `role="row"` elements. The rowgroup owned no rows. |
| `th-has-data-cells` (serious) | `<table data-testid="stats-table">` | With no connected device, `<tbody>` was empty, so none of the eight `<th scope="col">` had an associated data cell (header-only table). |

Both are **incomplete**, not violations, so a "0 violations" automated scan does not catch them. That is why the O9 fix needs an axe check that also asserts on `incomplete`.

## Change

- `src/components/TracePanel.tsx`
  - `.bw-trace-canvas` gains `role="presentation"`, so the rows inside are owned by the `role="rowgroup"` scroll container.
  - The empty state is moved **into** that rowgroup as a real `role="row"` with a `role="cell"`, so the rowgroup always owns at least one row and assistive technology finds the message when navigating the table. (Previously two `<p>` elements were direct, unroled children of `role="table"`.)
- `src/components/StatsPanel.tsx` — when there are no statistics, `<tbody>` gets one data row with a single `<td colspan="8">No statistics yet.</td>` instead of being empty. No fake counters.
- `src/styles/app.css` — `.bw-trace-empty` is now `top: 0` (it sits inside the scroll area, which already starts below the header); new `.bw-table td.bw-table-empty` is muted and left-aligned so the message stays visible when the table is wider than its panel.

No component behaviour, contract, Cloud or deployment change. Local-only, no plotune-cloud #120 dependency.

## Verification (what axe covers, what the added check catches)

| Check | Level | What it proves |
|---|---|---|
| `tests/bweb-042-o9.test.tsx` | L2 component | Statistics `<tbody>` always has a `<td>` with `colspan` equal to the header count; Trace body rowgroup owns a `role="row"` and the canvas is `role="presentation"` |
| `e2e/bweb-042-o9.spec.ts` — full axe `wcag2a/2aa/21a/21aa/22aa` | L3, real Chromium | 0 violations and **no `aria-required-children` / `th-has-data-cells` in `incomplete`** on empty and populated tables; initial workspace stays 0/23/0 |
| `e2e/bweb-042-o9.spec.ts` — targeted `withRules(['aria-required-children','th-has-data-cells'])` | L3 | both rules have **0 violations, 0 incomplete** and appear in `passes` — the check that would fail on the original markup |
| `e2e/bweb-042-o9.spec.ts` — DOM assertions | L3 | `role="presentation"`, an owned row, and a real `<td>` in the empty state |

Commands and results are in the PR body. Note that "0 violations" alone was already true before this PR; the improvement is the removal of the two **incomplete** results and the corrected row/header ownership.

## Before / after (standalone axe, both tables present, no device)

```
before (d56c0b6): 0 violations, 30 passes, 3 incomplete
  INCOMPLETE aria-required-children  .bw-trace-scroll
  INCOMPLETE th-has-data-cells       table
  INCOMPLETE color-contrast          span[title="Close Trace"], span[title="Close Statistics"]
after:            0 violations, 31 passes, 1 incomplete
  INCOMPLETE color-contrast          span[title="Close Trace"], span[title="Close Statistics"]
```

## Limitations

- The remaining `color-contrast` incomplete on the two panel-close icon `<span>`s is pre-existing, needs manual review (an icon glyph, not text), and is **out of O9 scope**.
- Verified in Chromium 141.0.7390.37 at 1280x900/1440x900 only; other browsers, screen readers and zoom were not run.
- `aria-rowcount` on the ARIA Trace table still counts data rows only (pre-existing, not changed here); rows are virtualised.
- The deployed page is not changed by this PR; owner merge + GitHub Pages deployment is the next blocker.
