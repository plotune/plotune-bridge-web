# Workspace v2

The Bridge workspace is a set of **canvases**. A canvas is a layout of **panels** that you arrange, name and keep. This replaces the three fixed pages (Capture, Diagnostics, Device) with a workspace you shape for the job.

Status: delivered in this repository. Items that need Plotune cloud work are in [V2.5](#v25-needs-cloud-work); the next step for the web app alone is [V3](#v3-web-app-only).

## What a user sees

- **Canvases** are the tabs above the workspace. Click to switch, double-click or press F2 to rename, right-click (or the menu key) for Duplicate, Move left/right and Delete (with Undo). **+** adds a canvas: blank, from a template, or a copy of the current one. A fresh install starts with Capture, Diagnostics and Device, as ordinary canvases you can rename, change or delete.
- **Panels** are tabbed groups. Drag a tab to the middle of another group to add it as a tab, or to an edge to split. Drag a divider to resize; with a divider focused, the arrow keys resize. Right-click a tab (or press the menu key) for Rename, Split right/down, Maximize and Close. **Add panel** opens a gallery; the **+** on a group adds to that group.
- **Panels that act on one device** (Channels, Statistics, Send frame, Device) can be pointed at any connected device when more than one is connected. Trace already shows every device or one. Diagnostics follow the selected device.
- **Scope** is the live plot (the old Plot): light and fast, for watching. **Analyze this window** keeps what is on screen as a **recording** and opens it in the **Analyzer**.
- **Analyzer** studies recorded data. See below.
- **Recordings** lists recordings made in this page and imports a CSV file (the Scope's own export, or a time column followed by one column per signal).
- **Workspaces** (the name in the top bar) are saved in this browser as you work. Rename, New, Open, Duplicate, Export/Import (a JSON file, copy or download). Ctrl K opens a command palette.
- **Phone**: one panel fills the screen, with a switcher at the bottom. Dragging and splitting are not offered on a phone; the canvas tabs and panel switcher are.

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
