# Bridge Web mobile canvas and panel acceptance

**Requirements:** BWEB-041 rev 1; BWEB-042 rev 1; BWEB-043 rev 2; BR-WEB-004 rev 2; BWEB-020 rev 1 (tablet layout only).

This record captures a user-facing baseline reproduction and the acceptance coverage added in
`e2e/mobile-canvas.spec.ts`. The baseline was `a7a88c25ca0ddca45b32c3246d15d1b1aff2af85` on the
`delivery/mobile-acceptance` branch. Selected baseline screenshots and their measurements are retained under
`docs/evidence/task027/`; raw browser traces remain local and ignored.

## Baseline phone session

I created five canvases at desktop width, renamed four to long names (`Calibration N with a long production name`),
then resized the page to 320×568 and 390×844. At 320×568, the document measured 325 px wide against a 320 px
viewport. At 390×844 the document fit, but the canvas tabs still extended well past the viewport: each long-name tab
was 180×32 px and started after x=166, with later tabs reaching x=889. The canvas navigation was therefore not
usable as a visible phone canvas selector. Captures: [baseline at 320×568](evidence/task027/baseline-many-canvases-320.png),
[baseline at 390×844](evidence/task027/baseline-many-canvases-390.png), and their measured values in
[baseline.json](evidence/task027/baseline.json).

A direct pointer attempt to activate **New canvas** at 320 px was intercepted by the recording-format `<select>` in
the top bar. This made the existing canvas-creation action inaccessible at that viewport. Existing panel switcher
coverage exercised one panel at a time, but did not provide phone actions to rename/delete canvases or rearrange
panels.

## Acceptance coverage

The new Playwright spec exercises the phone canvas picker and canvas lifecycle, panel add/remove/rename/move/split
and divider resizing, reload persistence, visible keyboard focus, and horizontal overflow at 320×568 and 390×844.
It checks phone interactive targets at a 44 px minimum in the touched picker/editor states. It also checks a two-panel
1024×768 tablet layout and a 1440×900 desktop layout. Axe runs with `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, and
`wcag22aa`; any `incomplete` items are reported by rule ID and node count in the test output for manual assessment.

The test file itself is the reproducible procedure. The integrated UI source under test was `b2c6406b463dbec1d7ad024a32701954249f5ca4` on top of the baseline commit. All six Playwright cases passed. The final phone picker and panel editor have no horizontal overflow, and every measured visible control in those states was at least 44 px high. Full measurements, browser version and test coverage are in [mobile-acceptance.json](evidence/task027/mobile-acceptance.json); selected after-change captures are [the 320×568 picker](evidence/task027/after-canvas-picker-320.png) and [the 390×844 panel editor](evidence/task027/after-panel-editor-390.png).

Axe reported zero violations for phone picker, panel editor, and desktop states using the requested WCAG 2.2 AA tag set. It returned incomplete color-contrast checks for decorative glyphs/short text and an incomplete label-content-name check for the icon-only Close control. These remain manual review items; the scan does not claim them as passes. The phone/tablet/desktop browser run does not qualify other BR-WEB-004 clauses such as account reconnection or hardware command safety.

## Verification record

| Requirement | Method / evidence | Result |
|---|---|---|
| BWEB-041 rev 1 | Phone canvas create/select/rename/duplicate/reorder/delete at 320×568 and 390×844; see `e2e/mobile-canvas.spec.ts` and JSON evidence | PASS — browser acceptance |
| BWEB-042 rev 1 | Phone panel add/rename/move into split and tab group/resize/close; touch targets, keyboard focus, and overflow; see same artifacts | PASS — browser acceptance |
| BWEB-043 rev 2 | Canvas and panel edits survive reload; see same artifacts | PASS — browser acceptance |
| BWEB-043-001 rev 1 | Phone canvas picker and layout editor actions in the corresponding Draft child requirement | PASS — browser acceptance against Draft criteria |
| BR-WEB-004 rev 2 | Workspace layout state survives reload; other requirement clauses were outside this acceptance session | PARTIAL — layout persistence only |
| BWEB-020 rev 1 | Two-panel 1024×768 tablet and 1440×900 desktop regression checks | PASS — browser acceptance |

Verifies: BWEB-041 rev 1
Verifies: BWEB-042 rev 1
Verifies: BWEB-043 rev 2
Verifies: BWEB-043-001 rev 1
Verifies: BR-WEB-004 rev 2
Verifies: BWEB-020 rev 1
