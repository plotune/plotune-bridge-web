# Bridge Web real-user visual findings — U4 + U8: top-bar recording controls

**Status:** Fix ready for owner review; **not merged**. One focused PR.
**Base:** `origin/main` `f9c7cb7` (O2 #78 and O7 #79 merged during the session).
**IDs:** real-user findings **U4 (Low/Medium)** and **U8 (Low)** from `/tmp/opencode/visual/FINDINGS.md`.
**Documentation style:** follows `docs/bweb-042-o3.md` / `docs/bweb-042-o9.md`. These are real-user visual findings, **not** BWEB-042 WCAG requirement items.

## Scope: two top-bar recording-control defects, one component

Both live in `src/components/RecordControl.tsx` and its CSS, so they are fixed together. U1/U3 (PR #80), U2 (PR #81) and U5–U7 are separate triage decisions.

### U4 — Recording-format select truncates its value

`select.bw-format-select { max-width: 76px }` renders the long option label `ASC (Vector text)` as `ASC (...` on desktop (`crop-topbar.png`). Its `title` was only `"Recording format"`, so the chosen format was never fully visible. On a phone the 700 px rule hid **all** `.bw-top-end select` elements, so the chooser measured 0 px and no overflow menu offered it — the user was locked to ASC.

### U8 — Recorded-file chip truncates with no way to read it

`.bw-record-status { max-width: 240px; text-overflow: ellipsis }` shows `Saved bridge-20261105-143010.asc · 67 f…`. The full file name and size had no `title`, so a sighted mouse user could not read them (screen readers already get the full `role="status"` text).

## Change

- `src/record/formats.ts` — `FormatSpec` gains `shortLabel` (`ASC`, `BLF`, `candump`, `CSV`). The full descriptive `label` is kept for the tooltip and for `docs/recording.md`.
- `src/components/RecordControl.tsx`
  - Options show `shortLabel`; each `<option>` carries `title={f.label}` and the `<select>` carries `title="Recording format: <full label>"`. The closed 76 px control now shows a complete value and the full name is on hover.
  - U8: the recording / saved status strings are computed once and passed to `title` on `.bw-record-status`, so the full file name, frame count and byte size are available on hover. `role="status"` and the announced text are unchanged.
- `src/styles/app.css` — the 700 px rule no longer hides the format select; it gets a 44 px touch target (WCAG 2.5.5 phone convention) and `max-width: 84px`, so the chooser is reachable on a phone.
- `e2e/record.spec.ts` — three `selectOption({ label: '<full label>' })` calls become `selectOption('<value>')`, because the visible labels changed. Selecting by stable value is more robust; the recording-format coverage is unchanged.
- No contract, Cloud or deployment change. No sheet edits.

## Verification (real browser + axe, both viewports)

| Check | Level | What it proves |
|---|---|---|
| `tests/bweb-042-u4-u8.test.tsx` | L2 component + CSS contract | every format keeps its full label and has a shorter code; the select and every option expose the full label on `title`; the phone rule keeps the select with a 44 px target and the blanket hide is gone |
| `e2e/bweb-042-u4-u8.spec.ts` | L3, real Chromium 1440×900 | the select shows a full short value, its `title` carries the full chosen label and updates when the format changes; after a real recording the `record-status` `title` equals the full (ellipsised) text and contains the file name + size; top-bar screenshot |
| `e2e/bweb-042-u4-u8.spec.ts` | L3, real Chromium 390×844 | the format select is visible (>0 px, 44 px tall) on a phone **with no document overflow**; top-bar screenshot |
| `e2e/bweb-042-u4-u8.spec.ts` | L3, axe `wcag2a/2aa/21a/21aa/22aa` | 0 violations at both viewports |

Commands and results are in the PR body.

## Limitations

- `title` tooltips are a mouse/hover affordance; on touch there is no hover. On a phone the saved chip is hidden anyway (existing `max-width: 1100px` rule), but the format chooser is now reachable.
- Native `title` tooltips are painted by the OS, not the page, so they do not appear in the screenshots. The e2e spec asserts the attribute and the full text instead.
- Verified in Chromium 141.0.7390.37 only, at 390×844 and 1440×900. No other browser, screen reader, zoom or 200% reflow. axe is automated WCAG 2.2 AA only; the 44 px phone target follows the project's F1 convention.
- BLF is offered only where `CompressionStream` exists (unchanged). The `candump` short code is the longest at 7 characters; it fits the 76/84 px control in the measured runs.
- Does not change the running 4174 preview or the deployed page: **owner merge + Pages deployment** is the next step. No merge performed.
