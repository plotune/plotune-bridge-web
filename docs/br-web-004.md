# BR-WEB-004 rev 2 — acceptance verification

**Status:** Verification record. **No source code changed** — the requirement was already implemented; this PR adds
executable, requirement-named acceptance tests and this honest verification record. No gap was found that needed a fix.
**Base:** `origin/main` @ `427f36a`. **Branch:** `verify/br-web-004`.

**Requirement (verbatim):**

> Bridge Web shall restore remembered workspace layouts, device identifiers and non-energizing preferences without
> persisting account credentials; it shall allow at most one automatic reconnection after successful sign-in, require
> explicit reconnection after connection failure or device replacement/session replacement, and never automatically
> replay hardware commands or output settings.

## 1. Mapping the sentence to four clauses

| Clause | Wording in the requirement | Where the behaviour lives |
|---|---|---|
| **(a)** | *restore remembered workspace layouts, device identifiers and non-energizing preferences without persisting account credentials* | `src/state/persistence.ts` (`WorkspacePersistence.load/save/decode`, `rememberableTarget`), `src/state/hub.ts` (`persist`, `create`/`restorePreferences`), `src/cloud/session.ts` (token memory-only), `src/cloud/context.tsx` (only the selected project ID is written) |
| **(b)** | *allow at most one automatic reconnection after successful sign-in* | `src/App.tsx` `RememberedReconnect` (one queue per `sessionGeneration`; each remembered remote device connected once; `setQueueSettled`), `src/state/hub.ts` (`remoteAwaitingSignIn`, `isAwaitingSignIn`, `queueSettledFor`) |
| **(c)** | *require explicit reconnection after connection failure or device replacement/session replacement (no silent retry)* | `src/state/store.ts` (`connect` catch, `onClosed`, generation checks, `explainOpenFailure`/`explainClose`), `src/transport/notices.ts` (actionable "Connect again"), `src/App.tsx` (settled queue offers an explicit Reconnect button) |
| **(d)** | *never automatically replay hardware commands or output settings on reconnect/restore* | `src/state/store.ts` (`restorePreferences` — "never to configure hardware"; `connect` reads live device state, does not send `set_bitrate`/`set_termination`/`start_rx`/`transmit`), `src/device/session.ts` ("a reconnect is a new DeviceSession … nothing is replayed") |

**Audit result:** every clause is implemented and enforced by the existing code. No genuinely failing behaviour was
found, so there was nothing to fix. In particular:

- **No credentials persisted.** The workspace record is an allowlist (only `version, devices, activeId, traceView, page,
  hidden, diagnostics, permissionExplained`; each device only `id, label, target, captureChannels, transmitChannel`) —
  enforced on both **write** (`save` → `decode`) and **read**. `rememberableTarget` refuses any URL with a username,
  password, query, fragment or non-root path. The account token lives only in a closure (`cloud/session.ts`); the PKCE
  verifier/state live transiently in `sessionStorage` for the OAuth round trip and are cleared on use — they are
  single-use secrets, not persisted account credentials. Only the selected project ID is written to `localStorage`.
- **At most one automatic reconnect per sign-in.** The queue is built once per `sessionGeneration`, connects each
  `isAwaitingSignIn` device exactly once, rechecks before each device, stops on sign-out / token replacement / unmount,
  and never loops or retries. A remembered **local** device (and any device added this page) is never auto-started.
- **Explicit reconnection.** A failed open, a lost link (1006) or a taken-over session (4001) leaves the device closed
  with an actionable notice; the store starts no retry of its own and the queue does not re-attempt a failed connect.
- **No replay.** Restore sets only disconnected local UI state; reconnect sends only `hello` + read-only polling.
  Energizing commands (`set_bitrate`, `set_termination`, `start_rx`, `stop_rx`) and output frames (`transmit`) are never
  re-issued, and `txLog` is not persisted.

## 2. Levels: what is L2, L3, and what is not verified

- All BR-WEB-004 evidence produced by this stream is **L2 (unit / component)**, executed with `vitest` in `jsdom`.
  The tests drive the **real** `WorkspacePersistence`, `DeviceHub`, `WorkspaceStore`, `DeviceSession` and the full
  `App` + `CloudProvider` tree, against the repository's contract-faithful fakes (`FakeTransport`, `MockDeviceCore`,
  `fakeSso`, in-memory `CloudClient`/`CloudSession`). They assert observable behaviour (persisted bytes, store state,
  transport-factory calls, DOM actions), not private fields.
- **No new L3 (e2e) check was added.** Clauses (a) and (d) already have real-browser reload coverage in the pre-existing
  `e2e/persistence.spec.ts` ("reload keeps the view, both devices and UI choices; reconnect reads live state without
  setup replay"). A new e2e check would duplicate that L3 test and add nothing the unit tests cannot. That existing
  e2e test was **not re-executed in this stream** (see §5).
- **L3 / UNVERIFIED — real cloud sign-in.** A "successful sign-in" in the L2 tests is a *faked* OAuth round trip
  (`prompt=none` redirect → callback fragment → `exchangeBridgeCode` → in-memory token). The real `plotune.net`
  redirect/callback/token-exchange against the live identity service, with a real Plotune account, cannot be exercised
  locally and is **recorded as UNVERIFIED, not passed**. The reconnect *policy* given a sign-in is verified; the
  identity transport is not.
- **Axe WCAG 2.2 AA:** **No UI was changed** (this PR adds only test files and documentation). No axe scan was run and
  none is required; there is no UI surface to scan.

## 3. Clause-by-clause verification table

All rows below were executed with `npx vitest run tests/br-web-004-*.test.*` (see §4). Result `PASS` means the
requirement clause is satisfied at the L2 level under the stated limitation.

| Clause | Test name(s) (`tests/br-web-004-*.test.ts(x)`) | Level | Result | Limitation |
|---|---|---|---|---|
| **(a)** restore layouts / identifiers / non-energizing prefs; no credentials persisted | `restore.test.ts`: *"restores the view, device target/label and preferences, disconnected, and starts no connection"*; *"scrubs credential and unknown fields from a saved record, so credentials are never persisted"*; *"never persists a credential-bearing endpoint"* ×4; `signin.test.tsx`: *"a successful sign-in keeps the token and one-time code out of every storage surface"* | L2 unit + component | **PASS** | Sign-in is faked; real `plotune.net` OAuth is UNVERIFIED. Storage surfaces checked: `localStorage`, `sessionStorage` (fake), DOM — cookies/IndexedDB are never written by the app and were not exercised. The transient PKCE verifier is legitimately in `sessionStorage` during the round trip (cleared on use); the account **token** and **code** never persist. |
| **(b)** at most ONE automatic reconnect after successful sign-in | `signin.test.tsx`: *"one sign-in starts exactly one reconnect of the remembered remote device, and nothing else is auto-started"*; *"a reload before a new sign-in reconnects nothing; only the next successful sign-in allows one more"* | L2 component | **PASS** | "Successful sign-in" is a faked token exchange (real OAuth UNVERIFIED). Verified as one queue / one connect per `sessionGeneration`, with no second reconnect for the same sign-in. |
| **(c)** explicit reconnection after failure / device / session replacement; no silent retry | `lifecycle.test.ts`: *"a failed connection is reported with an actionable notice and is never retried by itself"*; *"a session replacement (another window takes over) is reported and NOT reconnected by itself"*; *"a lost link is reported, no automatic retry happens, and reconnecting is an explicit action"*; `signin.test.tsx`: *"a failed reconnect leaves the device closed, offers an explicit Reconnect, and only a user click reconnects"* | L2 unit + component | **PASS** | Failures / takeover (4001) / loss (1006) are simulated with contract-faithful fakes; real network faults and a real second client taking over the hardware were not exercised. |
| **(d)** never auto-replay hardware commands or output settings on reconnect/restore | `restore.test.ts`: *"a restore + reconnect replays no config/capture/transmit command and no output frame"*; `lifecycle.test.ts`: *"connecting to a different device clears the earlier trace and issues no config/capture/transmit command"* | L2 unit | **PASS** | Uses `MockDeviceCore` (contract-faithful, but not real hardware). Real-browser reload coverage exists in `e2e/persistence.spec.ts` (L3, **not re-run here**). "Output settings" verified as: `txLog` empty, no `transmit`, and `transmitChannel`/`captureChannels` restored only as local UI state. |

## 4. Verification output (real, pasted)

Focused acceptance tests:

```
$ npx vitest run tests/br-web-004-restore.test.ts tests/br-web-004-lifecycle.test.ts tests/br-web-004-signin.test.tsx

 RUN  v5.0.5 /var/lib/plotune-nexus/worktrees/bridge-web-br4

 Test Files  3 passed (3)
      Tests  15 passed (15)
   Start at  13:16:41
   Duration  2.85s (environment 54%, transform 21%, tests 15%, setup 5%, import 5%)
```

`--reporter=verbose` lists the 15 named tests (all ✓), e.g.
`BR-WEB-004 (a) ... > restores the view, device target/label and preferences, disconnected, and starts no connection`,
`BR-WEB-004 (b) ... > one sign-in starts exactly one reconnect ...`,
`BR-WEB-004 (c) ... > a failed reconnect leaves the device closed, offers an explicit Reconnect, and only a user click reconnects`,
`BR-WEB-004 (d) ... > a restore + reconnect replays no config/capture/transmit command and no output frame`.

Full suite + static checks (all clean):

```
$ npm run typecheck
> plotune-bridge-web@0.1.0 typecheck
> tsc --noEmit
(no errors)

$ npm test
> plotune-bridge-web@0.1.0 test
> vitest run
 Test Files  57 passed (57)
      Tests  824 passed (824)
   Duration  22.04s

$ npm run build
> plotune-bridge-web@0.1.0 build
> tsc --noEmit && vite build
✓ 123 modules transformed. ... ✓ built in 243ms
(!) Some chunks are larger than 500 kB after minification (non-fatal advisory)

$ npm run lint
> plotune-bridge-web@0.1.0 lint
> eslint .
(no errors)
```

## 5. Limitations / not verified (plain statements)

- **Real cloud sign-in is UNVERIFIED.** The L2 tests fake `plotune.net`. A real OAuth redirect/callback/token exchange
  with a real account against the live `plotune.net` / `api.plotune.net` identity service was not run and cannot be run in
  this environment. This is recorded as unverified, **not** silently passed.
- **No new L3 e2e check** was added; it would duplicate `e2e/persistence.spec.ts`, which was **not re-executed** in this
  stream (Playwright/e2e is outside the required verification commands here). Its real-browser reload coverage is cited
  only as pre-existing corroboration for clauses (a)/(d), not as evidence produced by this PR.
- **No UI changed → no axe WCAG 2.2 AA scan** was run. There is no UI surface in this PR to scan.
- **Real hardware / real multi-client takeover** was not exercised. Clause (c)/(d) device and session replacement is
  simulated with `MockDeviceCore` and close codes (4001/1006), matching the contract.
- Storage surfaces in the credential test are `localStorage`, the fake `sessionStorage`, and the DOM. The app never
  writes cookies or IndexedDB; those were not separately probed.
- **Scope:** this PR changes no `src/` code (no gap to fix), does not merge, does not touch the requirements spreadsheet,
  and does not delete the worktree.
