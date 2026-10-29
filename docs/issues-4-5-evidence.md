# Issues #4 and #5 — verification evidence

2026-10-29 UTC. Linux, Node **v24.19.0**, npm **11.9.0**, repository baseline
`c34fcbc734f683048aabedbed238d46f8d5cf848`. No AGENTS.md was present in this
repository. Read both complete issues (neither had comments), README/docs, package
scripts, state/store/session/transport/protocol and existing browser suites.
No dependencies or package-lock change; installed with `npm ci --no-audit --no-fund`.
The existing Playwright version required Chromium headless shell **141.0.7390.37
(build 1194)**, installed with `npx playwright install chromium --only-shell`.

## Required checks — actual output

From repository root:

```text
$ npm run lint
> plotune-bridge-web@0.1.0 lint
> eslint .
# exit 0, no warnings/errors

$ npm run typecheck
> plotune-bridge-web@0.1.0 typecheck
> tsc --noEmit
# exit 0, no diagnostics

$ npm test
> plotune-bridge-web@0.1.0 test
> vitest run

 RUN  v5.0.5 /workspace/bridge-web
 Test Files  14 passed (14)
      Tests  235 passed (235)
   Duration  10.64s

$ npm run test:e2e
> plotune-bridge-web@0.1.0 test:e2e
> playwright test
Running 27 tests using 1 worker
  27 passed (38.6s)
```

No failed or skipped tests in these final runs. The browser suite includes real
WebSocket mock servers, zero-device access spies, storage-unavailable navigation,
reload with two remembered devices/current view/UI choices, explicit reconnect,
removing the last device, accessibility (axe) and existing diagnostics/close tests.

## Virtual-device suite (e2e-virtual)

Actual reference virtual Bridge + Step 3a bench/generator packages were already
available in a separate authorized local Nexus environment. They were started
as isolated loopback-only fixture processes; no simulator source or public
repository dependency was changed. The equivalent installed entrypoint commands
below show their exact arguments (each is a separate process):

```sh
plotune-bridge-can-virtual --transport ws --host 127.0.0.1 --port 19101 --generate-hz 10 --queue-capacity 1024 --loopback echo
plotune-bridge-can-virtual --transport ws --host 127.0.0.1 --port 19121 --generate-hz 10 --queue-capacity 1024 --loopback echo
plotune-bridge-can-virtual --transport ws --host 127.0.0.1 --port 19111 --generate-hz 30000 --queue-capacity 8 --loopback echo
plotune-bridge-can-virtual --transport ws --host 127.0.0.1 --port 19141 --generate-hz 10 --queue-capacity 1024 --loopback echo
plotune-bridge-can-generator --transport ws --host 127.0.0.1 --port 19201 --bridge-port 19202
plotune-bridge-can-generator --transport ws --host 127.0.0.1 --port 19301 --bridge-port 19302 --ws-origin https://bridge.plotune.net
```

Port 19141 is a separate two-channel device so CAN2 stays unconfigured for the
independent-channel regression. Do not reuse a device whose CAN2 has been set:
contract v0.1.0 has no “unconfigure channel” operation. No protocol workaround is
added. Start fresh fixture processes for a clean repeat.

With all seven URL variables exported, the exact browser command and real output:

```sh
export BRIDGE_VIRTUAL_URL=ws://127.0.0.1:19101
export BRIDGE_VIRTUAL2_URL=ws://127.0.0.1:19121
export BRIDGE_OVERFLOW_URL=ws://127.0.0.1:19111
export BRIDGE_SINGLE_CHANNEL_URL=ws://127.0.0.1:19141
export BRIDGE_BENCH_CONTROL_URL=ws://127.0.0.1:19201
export BRIDGE_BENCH_URL=ws://127.0.0.1:19202
export BRIDGE_BENCH_ORIGIN_URL=ws://127.0.0.1:19302
npm run test:virtual
```

```text
> plotune-bridge-web@0.1.0 test:virtual
> playwright test --config playwright.virtual.config.ts
Running 7 tests using 1 worker
  7 passed (19.7s)
```

**7 passed / 0 failed / 0 skipped.** Covers two-channel timestamps/loopback,
replacement, two-device merged trace/isolation, overflow counters, existing
ISO-TP/UDS/XCP synthetic responder scenarios, real server origin enforcement, and
CAN1 capture/send with CAN2 unset plus armed-state recovery after reload.

After adding the maximized channel screenshot, the same regression was rerun:

```text
$ npm run test:virtual -- --grep 'CAN1 captures/sends'
  1 passed (7.3s)
```

That is one repeated scenario, not an additional unique test.
Playwright printed its environment warning about NO_COLOR/FORCE_COLOR; it was not
an app console, lint or test failure.

## Additional checks

```text
$ npm run build
> plotune-bridge-web@0.1.0 build
> tsc --noEmit && vite build
# exit 0; static JS/CSS/fonts emitted to ignored dist/

$ npm run contract:verify
contract files match SOURCE.json (2 files, from plotune-nexus@366138c17424)

$ git diff --check
# exit 0, no output
$ git diff c34fcbc -- contract src/protocol src/transport src/device package.json package-lock.json
# exit 0, no output
```

## Regressions and review corrections

- CAN1-only and CAN2-only store tests first failed (**2 failed / 25 passed**),
  then passed after filtering capture to configured selected channels.
- The zero-device shell test failed against the initial one-placeholder/setup
  gate. Added the shell, explicit add/cancel flow and disconnected restoration.
- Browser tests exposed checkbox values reverting before batched notifications.
  Two focused unit/component regressions failed, then passed after immediate
  preference-input notifications; frame notifications remain batched.
- Updated old test assertions that required both channel bit rates; updated
  connection helpers to explicitly add a device and await the address/explainer
  render. Fixed a test locator that picked another device's Reconnect button.
- The first virtual run at 100 generated frames/s/channel was **6 passed / 1
  failed**: two-device trace rows scrolled outside its bounded rendered viewport
  before the Tx assertion. The final functional fixtures use 10 frames/s/channel;
  the separate overflow fixture remains 30000 frames/s/channel with capacity 8.
  This is not a throughput/performance claim or a disabled assertion.
- Fixed a TypeScript table-driven test tuple shape before the final check above.
  Interrupted/intermediate failed runs are not reported as passing verification.

## Screenshots inspected

All are real rendered application screens on loopback synthetic fixtures, without
accounts, tokens, private hosts or customer traffic:

- [Empty desktop workspace](screenshots/offline-workspace.png)
- [Empty mobile workspace](screenshots/offline-workspace-mobile.png) — 390px,
  with an automated check that the document has no horizontal overflow
- [Remembered devices after reload](screenshots/remembered-devices.png)
- [CAN1-only trace and transmit](screenshots/independent-can1.png)
- [Both channel configurations in the existing maximized panel](screenshots/independent-channels.png)

Generated by e2e/persistence.spec.ts and e2e-virtual/integration.spec.ts, inspected
visually. Existing permission screenshot helpers now also enter Add a device.
The whole legacy `npm run screenshots` gallery was not regenerated; these five
new screenshots document this change.

## Not tested, and why

- Physical Bridge, CAN wiring/electrical behavior, USB NCM, separate LAN device:
  only software reference endpoints on one host were available.
- Native Chrome/Edge/Brave permission prompts: automation spies verify no initial
  query/socket, and existing denial tests are explicitly simulations. Headless
  Chromium does not prove the native OS/browser permission dialog behavior.
- Real Firefox/Safari/iOS: existing Firefox-user-agent-in-Chromium tests are not
  tests of those browser engines; no real device/browser access was available.
- Trusted device wss certificates: existing wss test uses a throwaway self-signed
  certificate accepted by the isolated test browser only.
- Storage across browser profiles/clearing/site-origin changes, cross-tab sync,
  native screen readers: not supported/verified in this local prototype.
- Fresh uncached navigation while internet is unavailable: no offline installer,
  service worker or PWA was introduced; “offline shell” means a loaded workspace
  with no connected device or Cloud requirement.
- GitHub Pages deployment: no merge, deployment or workflow change performed.
