# Bridge Web real-user visual findings — U1 + U3: phone Trace layout

**Status:** Fix ready for owner review; **not merged**. One focused, responsive-layout PR.
**Base:** `origin/main` `58ce9b6` (BWEB-042 O2 / PR #78 merged; the running 4174 preview is still the older `41c1728` build).
**IDs:** real-user findings **U1 (High)** and **U3 (Medium)** from `/tmp/opencode/visual/FINDINGS.md`.
**Documentation style:** follows `docs/bweb-042-o3.md` / `docs/bweb-042-o9.md`. These are visual findings from the real-user pass, **not** BWEB-042 WCAG requirement items.

## Scope: the phone Trace, two concrete layout defects

U1 and U3 both come from one place: the `@media (max-width: 900px)` block in `src/styles/app.css`. They are fixed together because they are the same panel at the same width, and one screenshot (`80-mobile-trace-empty.png`) shows both. U2 (phone Statistics), U4 (top-bar format), U5–U8 are separate PRs / triage decisions.

### U1 — Phone Trace loses the payload columns

At `390×844` the narrow rule replaced the Trace grid with

```css
grid-template-columns: 84px 64px 84px 38px 32px minmax(0, 1fr);
```

and also hid the Type column (`.bw-trace-head .bw-c-type { display: none }`). The remaining `1fr` Data column was squeezed to ~14 px, so its header rendered as `D…` and the frame payload — the primary content of a CAN tool — could not be read. `report4.json` measured `scrollWidth − clientWidth = 0`: the table did not scroll, it collapsed.

Interestingly the file already contained the correct pattern for the *named* (`has-name`) variant: `.bw-trace.has-name { overflow-x: auto }` plus `min-width` on the header and scroll area let that table scroll sideways inside its panel. The fix applies that same pattern to **every** narrow Trace.

### U3 — Trace toolbar wraps into a broken shape

`.bw-panel-head { flex-wrap: wrap }` and `.bw-panel-tools { flex-wrap: wrap }` let the six header tools (Pause, Numbers/Hex, Follow, Clear, Maximize, Full screen) wrap three lines, with the full-screen icon orphaned on a third line at the far left. It reads as a layout bug, not a design. The fix keeps the tools on one tidy row that scrolls sideways if the phone is too narrow for all of them.

## Change

`src/styles/app.css`, mostly inside `@media (max-width: 900px)`, plus one line of markup in `src/components/TracePanel.tsx`:

- `.bw-trace` gains `overflow-x: auto` plus `scrollbar-width: thin` / a styled webkit thumb. `.bw-trace-head` and `.bw-trace-scroll` gain `min-width: 620px`; the header and the virtualised rows keep the same width, so they stay aligned while the panel scrolls sideways.
- **A definite scroll cue:** Chromium's scrollbars are overlays here (`offsetHeight − clientHeight = 0`, measured in the e2e run), so a styled scrollbar alone is not a reliable hint. `TracePanel.tsx` adds one line — `Scroll the table sideways for Dir, Len and Data →` — hidden by default and shown at `max-width: 640px`, where the 620 px table is guaranteed to overflow. It sits outside the `role="table"`, so table semantics are unchanged.
- The narrow grid becomes `104px 72px 88px 92px 44px 40px minmax(0, 1fr)` — seven columns, so the **Type column is no longer hidden**. At the 620 px minimum the Data column gets ~112 px, enough to read `96 AA` and formatted hex bytes.
- The `has-name` variant gets one extra column and `min-width: 760px`, keeping Name + Type + Data readable.
- `.bw-panel-tools` becomes `flex: 1 1 100%; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin` with `flex: none` children: one row, no orphaned icon, and a visible thin scrollbar when it overflows on the narrowest phones.
- No state, contract, Cloud or deployment change. One presentational `<p>` in `TracePanel.tsx`; no behaviour change.

## Verification (real browser + axe, both viewports)

| Check | Level | What it proves |
|---|---|---|
| `tests/bweb-042-u1-u3.test.ts` | L2 (CSS contract) | the 900 px block declares the horizontal-scroll rules, keeps a Type column, and makes the tools a single non-wrapping row |
| `e2e/bweb-042-u1-u3.spec.ts` | L3, real Chromium 390×844 | `.bw-trace` really scrolls (`scrollWidth > clientWidth`), Data header 112 px and Type header visible; a visible scroll hint; all `.bw-panel-tools` children share one row; no document overflow; screenshot |
| `e2e/bweb-042-u1-u3.spec.ts` | L3, real Chromium 1440×900 | desktop layout unchanged: no trace overflow, no scroll hint, Type visible, tools on one row; screenshot |
| `e2e/bweb-042-u1-u3.spec.ts` | L3, axe `wcag2a/2aa/21a/21aa/22aa` | 0 violations on the populated Trace at 390×844 and 1440×900 |

Commands and results are in the PR body. Before/after header widths at 390×844 (standalone Chromium on this branch's build):

```
before (41c1728 build): Time 84 | Channel 64 | ID 84 | Type 0 (hidden) | Dir 38 | Len 32 | Data 14   tableScroll 0
after:                  Time 104| Channel 72 | ID 88 | Type 92          | Dir 44 | Len 40 | Data 112  traceScroll 250 (panel scrolls)
```

## Limitations

- Horizontal scrolling only begins below roughly 640 px of panel width; between 640 and 900 px the wider, readable columns now fit without scrolling. That is a deliberate improvement over the old squeezed columns, not a regression.
- On a 390 px phone the payload (Dir / Len / Data) now sits to the right of the initial view and needs one sideways scroll to read; the hint line and thin scrollbar are the cues. This is exactly the "let the trace scroll horizontally inside its panel, like the Statistics table" fix the finding suggested — an alternative two-line row that keeps ID + data in view without scrolling was considered but left out to keep the change small.
- The hint is gated at `max-width: 640px`, where overflow is guaranteed; between ~620 and 640 px the table can just fit while the hint still shows. Harmless but not perfectly precise — a JS `scrollWidth > clientWidth` flag would be exact at the cost of more code.
- On the very narrowest phones the single tool row may need a short sideways scroll to reach the window (Maximize / Full screen) buttons; the thin scrollbar is the cue. Those buttons were previously visible but scattered over three lines.
- The `has-name` (DBC loaded) variant was verified by CSS contract and desktop browser, not with a real DBC file loaded on a phone.
- Verified in Chromium 141.0.7390.37 only; no other browser, screen reader, zoom or 200% reflow. axe reports automated WCAG 2.2 AA only; keyboard and focus were not re-audited here (the change is CSS-only and adds no focusable controls).
- This PR does not change the running 4174 preview or the deployed page: **owner merge + Pages deployment** is the next step. No merge performed.
