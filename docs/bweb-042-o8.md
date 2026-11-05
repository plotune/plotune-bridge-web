# BWEB-042 rev 1 — Address field: direct targets require an explicit port (O8)

**Status:** Approved requirement; this PR fixes **one** concrete gap from the audit.
**Base:** `origin/main` `427f36a` (parallel-delivery branch `feat/web-bweb-042-o8`).
**IDs:** BWEB-042 rev 1 (primary), Postel's law. Open item **O8** in `docs/ux-a11y-pass.md`.

## Scope: one gap, not all six

The audit (`docs/ux-a11y-pass.md`, "Open (6)") lists O2, O3, O7, O8, O9, O10. **O9 (PR #74) and O10 (PR #73) are already merged.** This PR addresses **O8 only**:

> O8 — Low / Postel's law — Address field: `parseTarget` trims, accepts `host:port`, `ws://`, `wss://`, and rejects `http://` with a clear message. A bare host with no port silently becomes `ws://host` (port 80). Code reading only, not run in the browser. *Require a port, or show the default in the hint.*

O2 (duplicate names), O3 (focus after a failure notice) and O7 (pending state before redirect) remain open and are out of scope. Per the parallel-delivery convention (O9/O10 each shipped their own fix doc), `docs/ux-a11y-pass.md` is left as the historical audit record and is **not** edited here.

## The gap

Before the fix, `parseTarget('192.168.1.50')` (and `ws://192.168.1.50`, `wss://192.168.1.50`) returned `ok: true` with the port omitted. `new URL('ws://192.168.1.50')` has an empty `.port`, so the browser opens the connection on the scheme default — **port 80 for `ws://`** (or 443 for `wss://`). The reference Bridge device serves its WebSocket on a non-standard port (`9101` in the docs, `9443` for the `wss://` path), so the app attempted the wrong port and the user saw a confusing "device unreachable" failure with no clue that the address was the cause.

## Decision: one honest rule, no default port

Direct targets (`host:port`, `ws://host:port`, `wss://host:port`) now **require an explicit port**. A bare host, or a `ws://` / `wss://` address with no port, returns `ok: false` with one clear message naming the missing port and giving the example from the field hint:

> `Add the port, for example 192.168.1.50:9101.`

No default port is invented anywhere (neither 80 nor 443), and the rule is deliberately **single**: it applies to `wss://` too.

**Why `wss://` also requires the port (rather than allowing the standard 443 default with a hint):**

1. **No invented default.** The root cause of O8 is silently assuming a port. 443 is a real web default, but assuming it here is the same guess that sent `ws://` connections to 80.
2. **The device's listener is not standard.** The documented secure endpoint is `wss://host:9443`, not 443. Defaulting to 443 would connect to the wrong listener for exactly the `wss://` case the app supports.
3. **One rule is easier to explain and to get right.** A `wss://` exception would mean two different rules and a hint that has to explain why one scheme is special. Users whose device really is on 443 can still type `:443` explicitly; being explicit removes the ambiguity that caused O8.

The port is detected from the **typed authority**, not `URL.port`: the WHATWG URL parser strips a port equal to the scheme default, so reading `URL.port` cannot tell "no port" from "`:80`". An explicitly typed default port is preserved in the normalised result so `parseTarget` stays idempotent and a remembered address round-trips. Remote targets (`remote:<project>/<device>`, reached through the Plotune cloud) are not direct addresses and are unchanged.

## Change

| File | Change |
|---|---|
| `src/lib/target.ts` | `parseTarget` requires an explicit port for direct targets; one `MISSING_PORT_ERROR`; `authorityOf` helper reads the typed authority; explicitly typed default ports preserved. Updated doc comment. |
| `src/state/store.ts` | An invalid target (a validation error) gets the honest title **"Check the device address"** instead of "This address cannot be opened from this browser"; the notice `kind` stays `blocked-by-browser` so the form offers only "Change address" (a retry of the same bad address is pointless). Browser-diagnostic `technical` text is dropped for validation errors. |
| `src/state/persistence.ts` | Comment documenting the no-crash behaviour; no logic change — `rememberableTarget` already returns `null` on `!ok` before any `new URL`, so a port-less legacy address degrades to a clean shell. |
| `src/components/ConnectView.tsx` | Hint updated to state that the port is required for every address, with `ws://` and `wss://` examples consistent with the error message. |
| `playwright.config.ts` | `E2E_PORT` env override (default 4173 unchanged) so this parallel agent can run its checks on its own preview port 4175 without colliding with the other agent's 4174. |

### Call sites checked

- **`store.connect`** — `parseTarget` returning `ok: false` flows through `connectPolicy` (`!target.ok -> { allowed: false, reason: target.error }`) into the notice summary; no transport is created, so **no socket ever reaches port 80/443**. The `ConnectView` form keeps the typed address in local state; "Change address" (`store.reset()`) brings the form back with the value intact, so the user can append the port (the form recovers).
- **`persistence.rememberableTarget` / `decode`** — a port-less address returns `null` (no exception). `decode` falls back to `emptyWorkspace()`, i.e. a clean, usable shell — **the app does not crash on an existing saved address without a port**; when that address is (re-)entered in the form, the validation error is shown. This matches the existing safe fallback for corrupt/unsupported stored data (`tests/persistence.test.ts`).
- **ConnectView hint** — same example, same "port is required" wording, now covers `wss://` too.

## Verification

Commands and real output are in the PR body. Summary:

| Check | Level | Result |
|---|---|---|
| `npm run typecheck` | L1 | pass (`tsc --noEmit`) |
| `npm test` | L2 | **55 files, 831 tests passed** |
| `npm run build` | L1 | pass (production `dist`) |
| `npm run lint` | L1 | pass (`eslint .`) |
| `npx playwright test e2e/bweb-042-o8.spec.ts` (`E2E_PORT=4175`) | L3 | **4 passed** |
| `tests/lib.test.ts` (`O8: direct targets require an explicit port`) | L2 | bare host / `ws://` / `wss://` without a port rejected with the exact hint; with-port accepted; default-port idempotency; a `:digits` in the path is not a port; remote unaffected |
| `tests/bweb-042-o8.test.ts` | L2 | `rememberableTarget` returns `null` for port-less addresses (no throw); a stored workspace with a port-less device loads as a clean shell (no exception); `store.connect` is blocked with the port hint and opens **no** transport |
| `e2e/bweb-042-o8.spec.ts` — no socket | L3 | bare host / `ws://host` / `wss://host`: no WebSocket constructed, the port hint is shown, the form recovers with the value retained |
| `e2e/bweb-042-o8.spec.ts` — explicit port | L3 | `127.0.0.1:9` is accepted, the socket is opened at `:9` (never `:80`), and no validation error appears |
| `e2e/bweb-042-o8.spec.ts` — saved address | L3 | a stored device with target `192.168.1.50` renders a clean shell with **no uncaught `pageerror`**; re-entering it shows the validation error |
| `e2e/bweb-042-o8.spec.ts` — axe WCAG 2.2 AA | L3 | see below |

### Explicit axe WCAG 2.2 AA scan of the connect screen

Tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`, full page, real Chromium, two states of the connect screen:

```
axe (connect screen, empty form, WCAG 2.2 AA):        0 violations, 30 passes, 0 incomplete
axe (connect screen, port validation error, WCAG 2.2 AA): 0 violations, 26 passes, 0 incomplete
```

Both scans assert an empty `violations` list. No `incomplete` results were raised in either state.

### Regression

The three existing e2e specs most affected by the connect form / address rules — `e2e/workspace.spec.ts`, `e2e/persistence.spec.ts`, `e2e/br-web-006.spec.ts` — were also run: **25 passed** on the default config (4173). Running the same subset on the required 4175 port gives 24/25; the single difference is a pre-existing assertion in `e2e/workspace.spec.ts` that hardcodes the origin `http://127.0.0.1:4173`, which correctly reads `...4175` on that port. It is a port artifact, not a regression (confirmed by the clean 25/25 on 4173). The 4174 process belonging to the other agent was not touched.

## Before / after

| | Before (`427f36a`) | After |
|---|---|---|
| `parseTarget('192.168.1.50')` | `ok: true`, `url: 'ws://192.168.1.50'` → connects on **port 80** | `ok: false`, error `Add the port, for example 192.168.1.50:9101.` |
| `parseTarget('wss://192.168.1.50')` | `ok: true`, `url: 'wss://192.168.1.50'` → connects on **port 443** | `ok: false`, same single port error |
| `parseTarget('192.168.1.50:9101')` | `ok: true`, `url: 'ws://192.168.1.50:9101'` | unchanged |
| `parseTarget('wss://192.168.1.50:9443')` | `ok: true` | unchanged |
| A bare `ws://host` on an unsupported browser / secure page | validation title said "cannot be opened from this browser" | validation title "Check the device address"; the same `blocked-by-browser` kind still gates "Change address" only |
| Saved address `192.168.1.50` (from an older build) | loaded as a device that would connect to port 80 | dropped to a clean shell on load (no crash); the port error is shown when re-entered |

## Limitations

- A legacy saved device whose address had no port is **dropped** on load (the whole saved workspace resets to a clean shell), because `decode` treats any non-rememberable device as corrupt. This is the existing, tested safe fallback — no crash, and the address can be corrected by re-entering it with a port. Preserving the incomplete address in place (so it can be edited rather than re-typed) is a possible follow-up but is out of O8 scope.
- An explicitly typed default port (`ws://…:80` / `wss://…:443`) is normalised away by the browser's URL parser; `parseTarget` preserves it in its output so it stays valid, but note the device itself listens on non-standard ports (9101/9443), so this is an unusual input.
- Verified in Chromium (Playwright 1.56.1 / `PLAYWRIGHT_BROWSERS_PATH`) at 1280x800 only. Other browsers, screen readers, zoom and 200% reflow were not run. The axe scan is automated and does not replace a manual WCAG review.
- The connect-screen axe scan asserts 0 **violations**; any future `incomplete` node would need manual review (none were raised here).
- This PR does not merge, deploy, or change the requirements spreadsheet. Owner merge + GitHub Pages deployment is the next step.
