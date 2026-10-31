# UX and accessibility pass (issue #17)

- **Date:** 2026-10-31
- **Base:** `origin/main` a4040e5. Fixes are on `chore/ux-a11y-pass`; nothing is pushed.
- **Scope:** the live Bridge page, built from this branch (`npm run build`), in eleven states.

## Method

- Chromium 1243 (`executablePath`), Playwright 1.56.1 and axe-core 4.14.0 from the repo's `node_modules`.
- The built `dist` is served as `https://bridge.plotune.net` with `page.route`. Everything the page calls is stubbed: the plotune.net authorize redirect (code and `login_required`), the token exchange, projects, devices, pairing token, remote ticket and ICE. The relay WebSocket registers the browser and never reports the device, so a connect waits and then fails at the device stage. Nothing reaches `stream.plotune.net`.
- Viewports: 1280x800 (desktop); 390x844 with `isMobile`, touch and DPR 2 (phone); 640x400 (the reflow equivalent of 200% zoom on 1280 CSS px).
- Per state: axe with `wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice`; a Tab walk from the top of the document recording each stop, its `:focus-visible` state and its outline; every visible enabled control compared with the walk; duplicate accessible names; heading and landmark census; live regions; control boxes from `getBoundingClientRect`; document overflow; focus read right after each state change (before any tab walk); feedback time from click to the new text.
- Reduced motion: `emulateMedia({ reducedMotion: 'reduce' })` at 1280, reading the spinner's animation and running animations.
- The harness is not in the repo. It lives in the session scratchpad.

## States x checks (after the fixes, 390 px unless noted)

PASS/FAIL refers to the fixed build. "Before" counts are in the findings table.

| # | State | axe (1280 / 390) | Keyboard (reach, focus ring, no trap) | Names and headings | Targets < 44 px | Overflow 390 / 640 | Focus after change |
|---|---|---|---|---|---|---|---|
| 1 | First visit (empty workspace) | PASS / PASS | PASS | PASS (heading "Your workspace") | PASS (checkbox labels 44 px) | PASS / PASS | Pane title (F7) |
| 2 | Signing you in | PASS / PASS (F2) | PASS | PASS | PASS | PASS (F3) / PASS | n/a, status screen |
| 3 | Sign-in card, remembered remote device | FAIL / FAIL (O1) | PASS | FAIL: no h1 (O1) | PASS | PASS / PASS | n/a |
| 4 | Add-device pane, signed in | PASS / PASS | PASS | PASS | PASS | PASS / PASS | n/a |
| 5 | Pairing code with countdown | PASS / PASS | PASS | FAIL: duplicate "Cancel" (O2) | PASS | PASS / PASS | Add a device (F5) |
| 6 | Connecting, "Waiting for your device" | FAIL / FAIL (O1) | PASS | PASS | PASS | PASS / PASS | Cancel (F4) |
| 7 | "Your device is not reachable" | PASS / PASS | PASS | FAIL: duplicate "Try again" (O2) | PASS | PASS / PASS | Pane title (O3) |
| 8 | Account menu open | PASS / PASS | PASS (Tab now moves on, F8) | PASS | PASS | PASS / PASS | Escape to trigger; Sign out to Sign in (F6) |
| 9 | Connected workspace | SKIPPED | SKIPPED | SKIPPED | SKIPPED | SKIPPED | SKIPPED |
| 10 | Device panel | FAIL / FAIL (O1) | PASS | FAIL: no h1 (O1) | PASS | PASS / PASS | n/a |
| + | Signed out after Sign out (peak end) | PASS / PASS | PASS | PASS | PASS | PASS / PASS | Sign in button (F6) |
| + | Add-device pane, signed out | PASS / PASS | PASS | PASS | PASS | PASS / PASS | n/a |

Reduced motion (1280): the spinner's `animationName` is `none`, 0 animations running, transitions `0s`. PASS.

Contrast: axe reports no `color-contrast` violation in any state. One incomplete node (`.bw-setup-empty`, 390) is covered by the open account menu, so it is not a failure.

Reachability: every visible enabled control is reached by Tab in every state. The controls not reached are the Panels checkboxes inside a closed `<details>`, which are correctly out of the tab order until the menu opens. No keyboard trap was found: each walk returns to its start, at most 27 stops.

## axe, before and after (violations, all moderate)

| State | Before | After |
|---|---|---|
| Signing you in | `landmark-one-main` (1280, 390, 640) | none |
| Connecting | `page-has-heading-one` | same (O1) |
| Sign-in card | `page-has-heading-one` | same (O1) |
| Device panel | `page-has-heading-one` | same (O1) |
| All other states | none | none |

Incomplete (manual review needed, not failures): `aria-required-children` and `th-has-data-cells` on the Trace/Statistics tables (O9); `aria-valid-attr-value` on the account menu trigger at 1280 (unchanged, not reviewed further).

## Findings

Severity: High = blocks a task for a profile; Medium = WCAG AA failure or a clear barrier; Low = minor or best practice.

### Fixed in this branch (10)

| ID | Sev | Law | Finding and evidence (before -> after) | Fix |
|---|---|---|---|---|
| F1 | Medium | Fitts; WCAG 2.5.5 (44 px) and 2.5.8 (24 px) | Sub-44 px controls at 390, summed over the 11 states: 189 -> 11 (the 11 are 16 px checkboxes inside 44 px labels). Examples: `Select Bridge 1` 63.5x18, `Sign in` 61x32, `Connect` 71x32, `Try again` 82x40, account menu items 228x35.5 | Phone media rule (`max-width: 640px`): buttons, small buttons, icon buttons (44 px wide), tabs, device select, menu items, selects, fields, summaries, footer links, checkbox labels to 44 px |
| F2 | Medium | WCAG 1.3.1, 2.4.1 (landmark) | Sign-in loading screen had no `main` (axe `landmark-one-main`) | `SignInPending` root is `<main>` |
| F3 | Medium | Fitts; layout | Document 405 px wide on a 390 px phone during sign-in; the top bar clipped "Signing in…". The sign-in screen also offered Start capture, which acts on nothing | Measurement controls hidden while signing in. 405 -> 390 |
| F4 | Medium | WCAG 2.4.3 (focus order) | After Connect the row was replaced and focus stayed on `body` (measured before the fix) | Connecting card moves focus to Cancel if focus was lost; the card's own live region is removed so there is one live region (F9). Measured: `button Cancel` |
| F5 | Medium | WCAG 2.4.3 | Pairing Done/Cancel removed the focused button; focus to `body` | Focus returns to "Add a device" (enabled). Measured: `button Add a device` |
| F6 | Medium | WCAG 2.4.3 | Sign out (menu) removed the menu; focus to `body` | Focus moves to the topbar Sign in button when a sign-out drops focus. Measured: `button Sign in` |
| F7 | Medium | WCAG 2.4.3 | "Sign in and add a device" removed itself; focus to `body` | Pane title (tabIndex -1) takes focus when the pane opens with focus lost. Measured: `h1 Sign in to connect your Bridge` |
| F8 | Low | WCAG 2.1.1 (keyboard, no trap in practice) | Tab in the account menu was prevented and returned focus to the trigger, so Tab could not move past the menu | Tab closes the menu and is not prevented. Measured: next focus `button Add a device` (was `button kantr`) |
| F9 | Low | WCAG 4.1.3 (status messages) | Remote connecting card had two nested live regions (card and ConnectStatus); each stage was announced twice. Live regions 2 -> 1 | Live attribute only on the direct-connect card |
| F10 | Low | WCAG 4.1.2 | Transmit ID and Data fields always pointed at `tx-id-error` / `tx-data-error`, which exist only after an error (axe incomplete `aria-valid-attr-value`, 2 nodes) | `aria-describedby` only when the error is shown |

Fixes that are not visible on desktop: F1 applies below 640 px only, so the desktop targets are unchanged (see O10).

Regression tests: `tests/accessibility-pass.test.tsx` (11 tests). Ten fail against the original source; the eleventh (Escape closes the menu and returns focus) guards behaviour that already worked. The phone rule is tested by its selector contract, since it is CSS only. No Playwright spec was added.

### Open (9): design or copy decision, or not measurable here

| ID | Sev | Law | Finding and evidence | Decision needed |
|---|---|---|---|---|
| O1 | Medium | WCAG 2.4.6 and best practice (`page-has-heading-one`) | Sign-in card, connecting card and device panel have no h1 (axe). Adding an h1 to the brand conflicts with `tests/first-open.test.tsx:107`, which expects one "Plotune Bridge" heading | Pick a heading scheme: brand h1 with content headings as h2 (needs test and style updates), or a page h1 per state |
| O2 | Low | WCAG 2.4.6 and 2.4.9 (link and button purpose) | Duplicate names: "Connect" per device row; "Try again" for the row and the notice; "Cancel" for pairing and the pane; "Add a device" for the sidebar icon and the pane button; "Sign out" for the menu and the pane | Unique labels, e.g. `aria-label="Connect bridge-7"` (label-in-name holds). Tests query these names (`shell`, `account-devices`, `unreachable-device`, e2e), so the change needs test updates |
| O3 | Low | WCAG 3.3.1, 4.1.3 | After a failure, focus lands on the pane title (the notice is announced as an alert, but focus is not on it) | Move focus to the notice, or keep the title |
| O4 | Medium | Jakob's law; consistency | Four labels for the same action: "Sign in" (topbar), "Sign in and add a device" (empty workspace), "Continue with Plotune" (pane), "Sign in with Plotune" (card) | Copy decision (owner approved the sign-in flow) |
| O5 | Low | Jakob; Peak-end | After signing in with no devices, the empty workspace still says "Sign in and add a device" while the topbar shows the username | Copy or state change |
| O6 | Medium | Tesler's law | The sidebar shows the technical target `remote:proj_1/dev-1` in monospace under a remembered remote device (signed-out card, 1280 screenshot) | Show the device name, keep the address for details |
| O7 | Medium | Doherty | Between Continue with Plotune and the plotune.net page there is no pending state (the redirect is `location.assign`). The sign-in screen is shown only on return. Not measured with real plotune.net latency: the stub returns at once (click to "Signing you in": 77-87 ms) | Measure on staging; decide a pending label before the redirect |
| O8 | Low | Postel's law | Address field: `parseTarget` trims, accepts `host:port`, `ws://`, `wss://`, and rejects `http://` with a clear message. A bare host with no port silently becomes `ws://host` (port 80). Code reading only, not run in the browser | Require a port, or show the default in the hint |
| O9 | Low | WCAG 1.3.1 (tables) | Trace and Statistics tables: axe incomplete `aria-required-children` (row roles) and `th-has-data-cells` (header-only table when empty) | Review the table semantics |
| O10 | Low | WCAG 2.5.8 (24 px) on desktop | Sidebar device select at 1280 is 63.5x18. It fails the 24 px AA size on desktop (F1 covers phones only) | Desktop size for the sidebar row |

Feedback (Doherty), measured at 1280 after the fixes with stub latency: pane open 44 ms; pairing code 54 ms; Connect to "Waiting for your device" 107 ms; Sign out 35 ms; sign-in click to "Signing you in" 77 ms (390: 87 ms). All within 400 ms, but these exclude real network time (see O7).

Other laws, checked in code or the page, no finding: Hick (sign-in card has two choices; the signed-out pane has three); Miller (pane grouped as account bar, project, devices, footer); Peak-end (sign-out ends on Sign in with focus; the first connection goes through the permission explainer).

## Not covered

- Screen readers were not run. Only the accessibility tree (via axe and the census) was checked.
- Browsers other than Chromium were not run.
- State 9 (connected workspace) was skipped. The e2e-virtual harness was not run.
- Timings use stubs; real network latency was not measured (O7).
- The 200% zoom check is a 640 px viewport, not the browser's zoom control.
- Postel (O8) is from code reading only.
- The reduced-motion check ran at 1280 only.
- Storage, inference and Stream were out of scope.
- GitHub Actions is unavailable through 2026-11-18, so no CI run; checks were run locally.
