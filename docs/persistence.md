# Browser workspace persistence

Issues #4 and #5 distinguish workspace state from device state. The workspace
always renders with an empty device list, including Capture, Diagnostics settings
and the Device view. Add a device is the explicit entry to the connection/permission
flow. Reconnect is an explicit later device action; restoring a list opens no socket
and does not query the Permissions API. Removing the final device leaves the shell.

## What is remembered

A single localStorage entry, `bw.workspace`, contains a version **1** object:

| Field | Scope / purpose |
| --- | --- |
| `devices` (maximum 8) | Stable browser IDs/labels, ordinary root ws/wss addresses, per-device `captureChannels` and `transmitChannel` choices |
| `activeId`, `traceView` | Selected device and trace source; references are validated against the restored list |
| `page` | Last Capture, Diagnostics or Device view, even with zero devices |
| `hidden` | Valid panel visibility choices per view |
| `diagnostics` | Existing non-secret example/request/response IDs, channel, padding and timeout preferences; an explicit field allowlist |
| `permissionExplained` | Whether the explanation was acknowledged; **not** a browser permission grant |

Only successfully connected devices or previously remembered devices are saved.
An unfinished/failed new entry can be canceled without adding it to the remembered
list. During an address edit, the last successfully connected endpoint remains
committed in storage until its replacement connects successfully. Cancel (including
while connecting) restores that endpoint and retains the previously added device. Device addresses
are browser-local metadata; Remove forgets an entry. No account sync or backend exists.

Capture includes only selected channels with a non-null current bit rate. An
unconfigured channel visibly stays idle and never blocks another configured
channel. With no configured selected channels, no start request is sent. Sending
on an unconfigured/disconnected channel stays disabled; the device remains the
source of final validation. A streaming channel's bit rate stays locked; another
idle channel can still be configured independently.

## What is deliberately not remembered

No device descriptor, actual bit rate, termination, armed/capture state, bus state,
statistics, dropped-frame counts, clocks, session IDs, pending requests, connection
state or permission results. No trace, received frames, send payload/history,
UDS security key/seed, XCP connection/memory data, credentials or tokens.

Custom WebSocket paths, userinfo, queries and fragments may carry credentials, so
those endpoints are **session-only** and omitted from the saved device list. The
transport's accepted address/protocol behavior is unchanged. This conservative
persistence rule does not add authentication or prevent connecting to a custom
endpoint during the current session. No new writer stores the old `bw.target`.

On reconnect, hello and existing status polling populate current hardware state.
The page sends no `set_bitrate`, `set_termination` or `start_rx` as a restoration
step. If capture remained armed on the device, the page reports that and resumes
displaying the stream, preserving its device timestamps and loss markers. Explicit
user actions can then change configuration/capture. No old transmit is replayed.

## Migration and failure behavior

`src/state/persistence.ts` owns an explicit migration from the previous unversioned
`bw.target`, `bw.hidden.*`, `bw.diagnostics`, `bw.permissionExplained` keys. It keeps
only safe/validated values, writes the v1 object and retires the old writers/keys.
An old root address becomes a disconnected remembered device; no hardware state
can be reconstructed from the old schema and none is invented.

The old application never stored a last view, so that migration starts at Capture.
Unknown/unsupported versions (including 0), malformed JSON, invalid device lists,
unsafe stored endpoints and duplicate IDs fall back to a clean empty Capture shell.
Invalid optional preferences fall back to known defaults/allowlisted values.
Every storage read, write and removal (including accessing localStorage itself)
is wrapped in try/catch. Blocked/private/full storage leaves the workspace usable
in memory. No persistence guarantee is made when the browser refuses storage.

Writes project only the fields above and compare serialized preferences first:
frame/statistics polling updates do not repeatedly write localStorage. Controlled
user inputs notify immediately; high-volume frame summaries retain batching.

## Scope choices and remaining questions

- Device list and per-channel UI choices are local to this browser/origin. Cross-tab
  synchronization is not added: another tab never silently takes over a device.
- The issues do not specify retaining recordings, unsent frames, diagnostics results,
  maximized/fullscreen windows or trace follow/scroll state. These remain transient;
  retaining measurement content would need a separate product/privacy decision.
- Confirm later whether custom path-only endpoints need an explicit safe-to-remember
  policy. Queries/fragments/credentials remain excluded; do not infer that arbitrary
  path text is safe to store.
- Offline shell is not an offline-install/PWA guarantee. A fresh uncached navigation
  still needs the static site; adding caching or offline tools is separate work.

Multiple unfinished entries remain reachable: selecting a draft reopens its
connection form, and removing the active entry opens the next draft if necessary.

No change to contract v0.1.0, transport protocol, WebRTC, device firmware or backend.
