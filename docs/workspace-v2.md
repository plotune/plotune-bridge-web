# Workspace v2

The Bridge workspace is a set of **canvases**. A canvas is a layout of **panels** that you arrange, name and keep. This replaces the three fixed pages (Capture, Diagnostics, Device) with a workspace you shape for the job.

Status: delivered in this repository. Items that need Plotune cloud work are in [V2.5](#v25-needs-cloud-work); the next step for the web app alone is [V3](#v3-web-app-only).

## What a user sees

The first screen is a **blank canvas**, with three small starting points (Trace, Scope, Analyzer) and a hint for ⌘K. Nothing else is on it: no introduction, no sign-in card, no header. Signing in and adding a device are one click away in the explorer and the account menu, and ask for attention only when the user asks for them.

- **Top bar** (one slim translucent row): explorer toggle, canvas tabs (a rounded segmented control) with **+**, then on the right Add panel, the ⌘K search, Record, Start/Stop capture (with the elapsed time) and the account. Every control is an icon; its words are the tooltip and the accessible name, with the shortcut where there is one.
- **Explorer** (left, ⌘B hides it): **Devices** and **Recordings**, and nothing that names the workspace; the workspace menu is the small "…" at the bottom. A device shows its state and channels, with icons for its settings, disconnect/reconnect and remove. With two Bridges there are two rows; the selected one is the one the panels without a device of their own act on.
- **Device settings** (the sliders icon on a device, or ⌘K "Settings: Bridge 2"): **Channels** (bit rate, termination, include in capture), **Databases**, the **Device** and its connection, and the **Diagnostic link**. Configuration is not a panel on a canvas, so a canvas never holds a Channels panel that can only show one of two identical devices. A saved workspace from before that still opens; the panels that moved are dropped.
- **Databases belong to a device's channel.** As in CANoe or Dewesoft, a DBC is linked to a channel *of a source*: Bridge 1 CAN1 and Bridge 2 CAN1 each have their own, so frames of two identical devices are decoded by the right file. "Same file as CAN1" reuses a loaded file. The Trace, the Scope and the Analyzer all name the source ("Bridge 2 · CAN1 · Message · Signal"). Files are read in the browser, remembered in this browser, and never uploaded. Databases saved before this change belong to Bridge 1.
- **Recordings are data sources too.** The upload icon in the explorer (or ⌘K "Open a log or CSV file…") opens CSV, Vector ASC, BLF or candump files. A log of CAN frames first opens a dialog like a device's settings: its channels (with frame counts), and a database for each. Channels without one stay raw. A log can have any number of channels (a 7-channel log lists seven). Its **settings** stay available from the explorer and from the Analyzer toolbar. Signals are decoded when they are added to a plot, so a log with millions of frames and thousands of signals stays light. Parquet is planned (V3).
- **Choosing signals at scale.** The Scope and the Analyzer choose signals in a searchable tree grouped by message and source, built for databases with thousands of signals: only the rows in view are drawn, messages are closed until a search opens them, and the search matches message, source and signal names.
- **Canvases** are the tabs. Click to switch, double-click or F2 to rename, right-click (or the menu key) for Duplicate, Move left/right and Delete (with Undo). **+** adds a canvas: blank, from a template, or a copy of the current one. A canvas is closed with the × on its tab (or Delete, or the menu), with Undo; the last one stays. A fresh install has one blank canvas.
- **Panels** are tabbed groups. Drag a tab to the middle of another group to add it as a tab, or to an edge to split. Drag a divider to resize; with a divider focused, the arrow keys resize. Right-click a tab (or press the menu key) for Rename, Split right/down, Maximize and Close. **Add panel** opens a gallery; the **+** on a group adds to that group. Panel tools (pause, clear, zoom, download…) are icons.
- **Panels that act on one device** (Statistics, Send frame) can be pointed at any connected device when more than one is connected. Trace already shows every device or one. Diagnostics follow the selected device and show a one-line summary of their link, with an icon that opens its settings.
- **Scope** is the live plot (the old Plot): light and fast, for watching. **Analyze this window** keeps what is on screen as a **recording** and opens it in the **Analyzer**.
- **Analyzer** studies recorded data. See below.
- **Recordings** lists recordings made in this page and imports a CSV file (the Scope's own export, or a time column followed by one column per signal). The explorer lists them too.
- **Workspaces** (the name at the top of the explorer) are saved in this browser as you work. Rename, New, Open, Duplicate, Export/Import (a JSON file, copy or download).
- **Phone**: one panel fills the screen. A thumb bar at the bottom holds the explorer, the panel chips and Add panel (44 px targets); the explorer opens over the canvas. Dragging and splitting are not offered on a phone; the canvas tabs and panel chips are.

### Shortcuts

| Shortcut | Does |
|---|---|
| ⌘K / Ctrl+K | Search canvases, panels and actions (add a panel, go to a canvas, device settings, start/stop capture) |
| ⌘B / Ctrl+B | Show or hide the explorer |
| ⌥N / Alt+N | New canvas |
| ⌥P / Alt+P | Add panel |
| ⌥1–9 / Alt+1–9 | Go to the first nine canvases |
| F2 | Rename the focused canvas tab |
| Esc | Restore a maximized group |

### Design

Quiet and neutral, in the manner of macOS: the system font (San Francisco on Apple devices), rounded corners (8 px controls, 10 px panels, 14 px dialogs), soft shadows, grey surfaces. Graphite is the one primary colour (the capture button, primary dialog buttons). The Plotune indigo `#5b62a7`, the colour of the logo, appears only where something is active or focused: the focused panel's edge, the focus ring, a selected row. Colour that carries meaning (status, plot lines) is kept apart from the chrome. The tokens are in `src/styles/tokens.css`; `tests/tokens.test.ts` checks the contrast of every pair that carries text.

A "workspace" here is a saved arrangement. It is not the Plotune account *project* that devices are paired to; saving a workspace into that project is V2.5.

## Analyzer

Modelled on the oscilloscope of ETAS MDA (see the [MDA user guide](https://docs.etas.com/mda/docs/V8.8.1/EN/Content/MDA_UserGuide_R8.8_EN.pdf), chapters on the oscilloscope, strips, axes, cursors and the time slider).

| Concept | Behaviour |
|---|---|
| Strips | Each strip has its own y axes; all strips share one time axis. Analog strips, a strip per two-state signal (filled steps) and an event strip. Add, delete, reorder from the strip's right-click menu. |
| Y axes | Per strip: one **common** axis, one axis **per unit**, or an **individual** axis per signal. Wheel over an axis scrolls it, Ctrl+wheel zooms it, a double-click opens an exact range, favourite range, zoom to fit. |
| Time | Wheel zooms around the pointer, Shift+wheel and drag pan, Shift+drag or right-drag draws a zoom area (a mostly horizontal drag zooms time, vertical zooms values, diagonal both). The **time slider** under the plot shows the whole recording: drag the window or its edges, double-click an edge to expand. |
| Cursors | **Cursors** adds A, then B, then removes both. Drag them, click the plot, or use the arrow keys (Sample-wise steps from sample to sample). The signal list shows A, B and B−A; Δt and frequency are drawn between them. |
| Statistics | Min, max, average and standard deviation of each signal over the cursor range, or the visible range when there are no cursors. |
| Calculated signals | A formula over the recording's signals (`BatteryV * BatteryA`). Parsed here, never run as code; inputs are step-interpolated. Stored as the formula, so a file holds no data. |
| Keyboard | The plot takes focus: arrows move the cursor or pan, Home/End/PageUp/PageDown, +/- zoom, F fits axes, C cycles cursors, Ctrl 1 switches the active cursor. Every pointer action has a toolbar or menu equivalent, and the signal list is the accessible table of values. |

Drawing costs the width of the plot, not the number of samples: each pixel column keeps the first, lowest, highest and last value.

## Data and storage

| What | Where | Notes |
|---|---|---|
| Saved workspaces | `localStorage` key `bw.projects`, version 2 | Up to 20 workspaces, 24 canvases and 120 panels each. Validated on read and on import: unknown panel types, duplicate panels, bad sizes and deep trees are dropped. Opening the page writes nothing; the first change does. |
| Panel settings | inside the workspace | Analyzer settings (strips, axes, view, cursors, calculated formulas) are saved with a short delay. |
| Recordings | memory | Lost when the page closes. Copy CSV in the Analyzer keeps one. |
| Devices and sign-in | unchanged (`bw.workspace`, cloud keys) | A workspace never holds a device address, token or captured data. |
| Scope selections | `bw.plot` for the first Scope, `bw.plot.<panel id>` for others | |

A saved workspace that refers to a recording no longer in memory shows "This recording is not available here" in its Analyzer and keeps its settings.

## Known limits (V2)

- Recordings are not kept across reloads and are not shared between devices.
- Workspaces are per browser: opening one on another device needs V2.5.
- Only CAN devices exist today. Panels are source-agnostic (`accepts` data kinds) and per-device panels already take a device; Serial, DAQ and I/O devices need device contracts first (V2.5).
- Diagnostics panels follow the selected device.
- One recording per Analyzer; open two Analyzers to compare.

## V2.5 (needs cloud work)

Tracked in [plotune-bridge-web#43](https://github.com/plotune/plotune-bridge-web/issues/43) and [plotune-cloud#117](https://github.com/plotune/plotune-cloud/issues/117).

1. Workspace storage in the Plotune project: list, get, put (with revision check), delete; size and count limits.
2. Sync and conflict handling in the web app (last opened device, "newer copy exists").
3. Recording storage in the project (upload, list, download, quota, retention).
4. Sharing a workspace with project members (read-only first).
5. Device contracts and relay support for Serial, DAQ and I/O devices, so the same panels can read them.

## V3 (web app only)

Tracked in [plotune-bridge-web#42](https://github.com/plotune/plotune-bridge-web/issues/42).

Drag a signal onto a plot or a strip; two recordings in one Analyzer with a time offset; keep recent Scope history so you can scroll back; XY plot, histogram and event list; floating and pop-out panels; per-panel diagnostic device; keyboard equivalents for every drag; a layout switcher for phone and tablet; recordings in IndexedDB.
