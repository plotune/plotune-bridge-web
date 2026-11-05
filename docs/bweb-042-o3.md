# BWEB-042 rev 1 — WCAG 2.2 AA: focus on failure notices (O3)

**Status:** Approved requirement; this PR fixes **one** concrete gap from the audit.
**Base:** `origin/main` `427f36a` (PRs #72, #73, #74 merged and deployed).
**IDs:** BWEB-042 rev 1 (primary), WCAG 3.3.1 (Error Identification) / 4.1.3 (Status Messages). Open item **O3** in `docs/ux-a11y-pass.md`.

## Scope: one gap

The audit lists O2, O3, O7, O8, O9, O10. O10 was fixed in PR #73 and O9 in PR #74. This PR addresses **O3 only**:

> O3 — WCAG 3.3.1, 4.1.3: After a failure, focus lands on the pane title (the notice is announced as an alert, but focus is not on it). Move focus to the notice, or keep the title.

O2 (duplicate names), O7 (pending state before redirect), O8 (bare host without a port) remain open; the `ContextMenu` focus-loss finding also remains a follow-up.

## The gap

Reproduced on `427f36a` with a real Chromium: after a failed local connect (`127.0.0.1:9`), `document.activeElement` was `BODY`. The `NoticeCard` had `role="alert"` (so it was announced) but no `tabindex` and was not focused; the next Tab went to a "Technical details" summary at the start of the page, not to the failure or its recovery actions. In the account/remote path the `AccountDevices` F7 effect put focus on the pane `h1` instead.

| | Before | After |
|---|---|---|
| Focus after a connect failure | `BODY` / pane `h1` | the `[data-notice=...]` alert |
| Notice attributes | `role=alert`, no `tabindex` | `role=alert`, `tabindex=-1` |
| First Tab after the failure | off into the page | stays inside the notice |

## Change

- `src/components/Notice.tsx` — an **error** `NoticeCard` is now programmatically focusable (`tabIndex={-1}`) and focuses itself when a *new* failure appears, so the recovery actions are the next Tab stops. Informational notices stay passive (`role=status`, no tabindex, no focus).
  - **Identity guard:** a `useRef` key of `kind|title|summary|technical` means each distinct failure is considered once per mount. A parent re-render that passes a freshly constructed but identical notice object does **not** yank focus back to the card.
  - **Focus-location guard:** focus is only taken from `body` or the connection UI (`.bw-connect`, `.bw-account`, `.bw-connecting`, `.bw-add-device`, `.bw-dock`, `.bw-sign-in-card`, `.bw-notice`). It is never taken from an `input`/`textarea`/`select`/contenteditable, a dialog/menu, or another panel — so a user typing in the Trace filter keeps their focus.
  - Because `NoticeCard` mounts before (or alongside) `AccountDevices`, and `AccountDevices`' F7 effect only focuses the title when focus is `body`/`null`, the notice wins without changing F7 for the no-failure case.
- `src/components/NoticeDock.tsx` — comment updated: the dock itself does not take focus; an error notice inside it does.
- `src/styles/app.css` — `.bw-notice[tabindex='-1']:focus` shows the focus ring (programmatic focus does not reliably match `:focus-visible`).

No contract, Cloud or deployment change. Local-only, no plotune-cloud #120 dependency.

## Verification (axe is explicit)

| Check | Level | What it proves |
|---|---|---|
| `tests/bweb-042-o3.test.tsx` | L2 component | error notice is an alert with `tabindex=-1` and takes focus; info notices stay passive; the notice wins over a pane title; a fresh identical object does not yank focus back; typing in another panel keeps focus |
| `e2e/bweb-042-o3.spec.ts` | L3, real Chromium | after a failed connect `document.activeElement` IS the alert (not `body`, not a heading); Tab stays inside the notice; Enter on "Change address" restores the address form; a simulated denied-permission failure also focuses its own alert |
| `e2e/bweb-042-o3.spec.ts` | L3, axe `wcag2a/2aa/21a/21aa/22aa` | 0 violations on the failure state and on the initial workspace (0/23/0) |

Commands and results are in the PR body. Note that "0 violations" was already true before this PR; the improvement is the **focus placement**, proven by keyboard/focus assertions, not by axe. axe is included so every verification also confirms no automated regression from `tabindex=-1` on an alert.

Before/after focus probe (standalone Chromium on the shared 4174 build):
```
before: active=BODY  noticeRole=alert  noticeTabIndex=null  noticeFocusable=false
after:  active=DIV.bw-notice.bw-notice-error role=alert  noticeTabIndex=-1  noticeFocusable=true
        after Tab: SUMMARY "Technical details" (inside the notice)
```

## Limitations

- Focusing an `alert` may cause some screen readers to announce it twice (once as a status message, once as the focused element). This is the tradeoff explicitly requested by O3 ("move focus to the notice"); the alert role is retained for WCAG 4.1.3.
- Warnings (`severity: 'warning'`, `role="status"`) do not take focus — only errors. O3 concerns failures.
- Focus is deliberately **not** stolen while the user is typing in another panel; in that case the alert is still announced but focus stays put.
- Verified in Chromium 141.0.7390.37 only; no other browsers, screen readers, zoom or 200% reflow. O2/O7/O8 remain open; remote WebRTC / Cloud save (BWEB-001/003, plotune-cloud #120) not verified.
- The deployed page is not changed by this PR; owner merge + GitHub Pages deployment is the next blocker.
