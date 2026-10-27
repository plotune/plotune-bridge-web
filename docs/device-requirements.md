# What a device must do to work with this page

The workspace connects **directly from the browser to the device** over a WebSocket. These are the requirements on the device side. They follow the Bridge CAN device contract (v0.1.0) and its transport guideline; the machine-readable parts are vendored under [`contract/`](../contract).

## 1. Allow this page's origin (required)

Browsers always send an `Origin` header on a WebSocket handshake. A device that checks it, as the reference device does, **must list the origin of the page**, or the handshake is refused with HTTP 403 and the page can only report that it could not connect.

| Where the page is served from | Origin to allow |
|---|---|
| The hosted workspace | `https://bridge.plotune.net` |
| Local development (`npm run dev`) | `http://localhost:5173` |
| The local production preview (`npm run preview`, used by the tests) | `http://127.0.0.1:4173` |

Exact match, scheme included. The page shows its own origin on the connect screen (with a copy button) so the user can enter it on the device.

With the Plotune reference virtual device:

```bash
# default: localhost origins only (any port); the hosted origin is refused with 403
plotune-bridge-can-virtual --transport ws --port 9101
# allow the hosted workspace (replaces the default list; native clients without an Origin header are always accepted)
plotune-bridge-can-virtual --transport ws --port 9101 --ws-origin https://bridge.plotune.net
```

An Origin check protects against other web pages talking to a device. It is **not authentication**; anything that can reach the device and omit the header can connect.

## 2. Speak the contract over WebSocket

- One **UTF-8 JSON text frame per contract message**. No newline delimiting, no binary frames (the page closes the link with code 4000 if the device sends one).
- Accept requests of at least **4096 bytes**; the page never sends more.
- `timestamp_ns`, `since_ns`, `monotonic_ns` and `wall_clock_ns` are **unsigned 64-bit integers written as plain JSON integers**. The page reads them as `BigInt` and never converts them to a double.
- Reply to `hello` with `can_fd: false`. The page refuses a device that advertises CAN FD.
- Answer WebSocket pings so the page's link-loss detection stays quiet.

## 3. One session at a time, and what the user sees on a close

A new connection **replaces** the current one when it is accepted, before any `hello`. The page does not reconnect by itself after being replaced (two windows would otherwise fight over the device); it shows a notice with a Reconnect button.

| Close code | Meaning | What the page tells the user |
|---|---|---|
| 4001 | A newer connection replaced this one | Another window or tool took over this device. Connect again to take it back. |
| 1013 | The device's send queue overflowed (the page could not keep up) | The device closed the link because this page could not keep up. It keeps capturing and counts what it dropped. |
| 1003 | The device rejected a message type (for example binary) | The device rejected something this page sent. This should not happen. |
| 1009 | The device rejected a message as too large | As above, mentioning size. |
| 1001 | The device is going away (restart, shutdown) | The device ended the connection. Connect again when it is ready. |
| 1006 | No close frame arrived (cable, Wi-Fi, power) | Lost the connection to the device. |
| 4000 | (sent **by the page**) the device sent invalid data | The page closes the link instead of guessing. |

Raw codes only appear under "Technical details".

### Several devices

The page can hold up to eight devices at once, each on its own WebSocket and its own session. Every device must allow this page's origin (section 1) and each is replaced independently (above). Device clocks are **not** synchronised with each other, so the merged trace shows frames in the order they arrive on the page, with each device's time relative to its own first frame. A device that can report its wall-clock time does so in `hello`; the page shows whether it is synced on the Device window, but does not use it to merge devices.

## 4. Offer `wss://` if you can

A secure address avoids the browser's restrictions on plain `ws://` from secure pages, and is the only direct option in browsers that block `ws://`. The page accepts `wss://` addresses and makes no assumption about them. Certificate provisioning (a certificate the browser trusts) is outside this page and not covered here.

## 5. The browser asks first

On a public HTTPS page, Chromium browsers ask the user whether the site may access devices on the local network before the connection can open. The page explains this before the first connection and handles a Block answer with a clear message and a retry. Nothing on the device can change that prompt.
