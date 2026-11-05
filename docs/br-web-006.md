# BR-WEB-006 rev 2 — declared browser, hosting and device-origin requirements (V1)

**Status:** Approved requirement; this is the Bridge Web V1 declaration and its verification record.
**Applies to:** the static Plotune Bridge workspace served at **https://bridge.plotune.net** (GitHub Pages).
**Also covers:** BWEB-002 rev 1 (local workspace independence), and the local-WebSocket half of BR-WEB-001 rev 2.
**Related, not verified here:** BWEB-001 / BWEB-003 (Cloud save/open/autosave, blocked on plotune-cloud #120); the remote WebRTC half of BR-WEB-001.

This document is the "**state**" half of the requirement; the "**enforce**" half lives in `src/lib/browser.ts`, `src/lib/permission.ts`, `src/lib/target.ts`, `src/transport/websocket.ts`, `src/transport/notices.ts` and `src/components/ConnectView.tsx`.

## 1. Supported browser matrix (V1 declaration)

| Browser | Direct local connection | Notes |
|---|---|---|
| **Desktop Chromium, Windows 11 x64** | **Reference / supported** | The declared reference platform for release review. On a public HTTPS page the browser asks for local-network access before the first connection. |
| Other desktop Chromium (Chrome, Edge, Brave, Opera; other desktop OS) | Supported target | Detected as `chromium`; the same permission and mixed-content rules apply. Not the declared reference. |
| Firefox | Not supported for plain `ws://` from a secure page | `connectPolicy` rejects it with plain guidance. `ws://localhost` / `ws://127.0.0.1` are allowed in Firefox; `wss://` is attempted, not pre-judged. |
| Safari / WebKit / any browser on iOS or iPadOS | Not supported for plain `ws://` from a secure page | Every iOS browser is WebKit underneath. `wss://` is attempted. |
| Screen readers, other engines, mobile browsers | Not verified | Automated axe checks only; no screen-reader release review. |

`detectBrowser` classifies the family and `connectPolicy` is the enforcement point. Unsupported combinations are **rejected up front** with a plain reason rather than a doomed attempt. Chromium's local-network permission may still be denied by the user; that case is detected after the attempt and explained plainly (section 4).

**Tablet:** the two-panel tablet layout remains required. No desktop File System Access API is assumed to be available on every tablet; workspace import/export uses ordinary file inputs.

## 2. Hosting

- The application is a **static build** (`vite build`, relative asset base), published by GitHub Actions to GitHub Pages at `https://bridge.plotune.net`. No server-side code, no secrets, no runtime API of our own.
- The page sets a Content-Security-Policy allowing `connect-src 'self' ws: wss: https://api.plotune.net https://stream.plotune.net` — i.e. direct device WebSockets plus the two optional Cloud hosts.
- **Initial hosted-page load may require Internet.** No installable, offline, service-worker or PWA distribution is implied or provided. Once loaded, the local workspace does not require Cloud access (section 5).
- Local development `http://localhost:5173` and the local production preview `http://127.0.0.1:4173` are also valid origins and are named in the on-screen instructions.

## 3. Device-origin requirements

A browser always sends an `Origin` header on a WebSocket handshake. A device that checks it must allow, **exact match including scheme**:

| Where the page is served from | Origin the device must allow |
|---|---|
| Hosted workspace | `https://bridge.plotune.net` |
| Local development | `http://localhost:5173` |
| Local production preview (used by tests) | `http://127.0.0.1:4173` |

The connect screen shows the page's own origin with a copy button, with "The device must allow this page". An Origin check is **not authentication**. The device must speak the Bridge CAN contract v0.1.0 over one UTF-8 JSON text frame per message, accept ≥ 4096-byte requests, answer `hello` with `can_fd: false`, answer pings, and replace (close 4001) an older connection. See [`device-requirements.md`](device-requirements.md).

## 4. Local-network permission and mixed-content / origin rules

- On a public HTTPS page, Chromium asks the user whether the site may access devices on the local network. `PermissionExplainer` explains this before the first connection. A **Block / denied** answer is detected (`queryLocalNetworkPermission`, best-effort; "unknown" is never reported as "denied") and answered with plain, actionable guidance: open the site settings, set "Local network" to Allow, then retry. Denied takes priority over a generic timeout.
- **Secure HTTPS origin + plain `ws://` to a non-loopback host is an unsupported mixed-content combination.** Chromium refuses to construct the WebSocket with a `SecurityError` ("An insecure WebSocket connection may not be initiated from a page loaded over HTTPS"), even when local-network access is granted; this is a browser rule, not a device fault. Bridge Web detects that definitive browser reveal and shows the `mixed-content` notice: use `wss://` if the device offers it, or open the workspace from a local origin. It never claims the device is powered off, unreachable, or that the browser revealed an unknown cause.
- **Loopback** (`127.0.0.1`, `localhost`, `::1`) and **`wss://`** endpoints are permitted from a secure page and are not pre-judged.
- A failed open where the browser reveals nothing (close 1006) is reported honestly as "The browser does not say why a connection fails" with a list of usual causes, the origin the device must allow, and the `wss://` hint. Raw close codes appear only under "Technical details".
- `connectPolicy` deliberately does **not** pre-judge a combination the reachability spike did not see fail outright (for example Chromium + secure page + plain `ws://`): a failed attempt is reported honestly, and a blocked one never gets the chance to work. The mixed-content rule above is enforced by the browser and detected by the page.

## 5. Local workspace independence (BR-WEB-006 rev 2 + BWEB-002 rev 1)

Once the page is loaded, the local workspace uses **only browser-owned storage** (`bw.workspace`, `bw.projects`, `bw.dbc`, `bw.explorer`). It does not call `api.plotune.net`, `stream.plotune.net` or `plotune.net` to open, edit or keep a local workspace.

- With **Cloud blocked after load** (all Cloud hosts aborted), an already loaded local workspace opens, can be edited, connects to a permitted local device, and completes local acquisition/control (set bit rate, start/stop capture) — see `e2e/br-web-006.spec.ts`.
- **After sign-out** (or with Cloud unavailable), an existing local workspace opens, can be edited, and is **not erased** — see `tests/br-web-006-local-workspace.test.tsx` and `e2e/br-web-006.spec.ts`. Sign-out clears only the in-memory account token and Cloud project/device lists; it never clears local browser storage.
- Local-only operation is why BWEB-001 / BWEB-003 (Cloud save/open/autosave) remain blocked on plotune-cloud #120 and are **out of scope** for this PR.

## 6. Verification record

| AC / clause | Test (level) | Command |
|---|---|---|
| Declared browser matrix, unsupported combination rejected with plain reason | `tests/br-web-006.test.ts` (L2 unit) | `npm test` |
| Denied permission priority; `SecurityError` → plain mixed-content guidance; "unknown" never denied | `tests/br-web-006.test.ts` (L2 unit) | `npm test` |
| No pointless "Try again" for a browser-refused combination | `tests/br-web-006-connect-view.test.tsx` (L2 component) | `npm test` |
| After sign-out the local workspace opens, is editable and is not erased | `tests/br-web-006-local-workspace.test.tsx` (L2 component) | `npm test` |
| Hosted HTTPS origin: declared origin shown; plain `ws://` LAN address explained as a browser rule; denied permission explained; Cloud blocked after load does not stop local acquisition/control or erase the workspace | `e2e/br-web-006.spec.ts` (L3 integration) | `npm run test:e2e` |
| Real ESP32-S3 Bridge CAN local WebSocket evidence (headless Chromium + `localNetworkAccess` grant) | `scripts/real-device-evidence.mjs` | `node scripts/real-device-evidence.mjs` |

Evidence of the real-device run: [`evidence/br-web-006-real-device.md`](evidence/br-web-006-real-device.md).

## 7. Limitations

- The native local-network permission prompt cannot be shown or answered by automation. Denied-permission tests **simulate** it (`simulateLocalNetworkPermission`) and are labelled as simulations. The real-device run grants `localNetworkAccess` through CDP.
- The available test browser is **Chromium 141.0.7390.37** (Playwright 1.56.1). The declared reference is desktop Chromium Windows 11 x64; other browsers, screen readers and mobile browsers were not run.
- On the hosted HTTPS origin, a plain `ws://` **non-loopback** endpoint is refused by the browser as mixed content. Real-device local WebSocket evidence is therefore gathered on the declared **local preview origin** `http://127.0.0.1:4173`, where a plain `ws://` LAN address is permitted and the device allows that origin. The hosted HTTPS origin requires a `wss://` device endpoint (certificate provisioning is outside this page).
- The real device is an ESP32-S3 Bridge CAN with **no CAN bus attached**; capture can be armed but no bus traffic is generated.
- `dist/` is served locally for tests; the hosted deployment at `https://bridge.plotune.net` is the owner's merge/deploy action, not part of this PR.
- Remote (Cloud/WebRTC) connection, BWEB-001/003 Cloud save, and the remote half of BR-WEB-001 are **not verified** here.
