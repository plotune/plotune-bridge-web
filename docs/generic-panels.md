# Generic panels and data sources (#18)

Status: foundation only. CAN behaviour is unchanged; nothing new is visible to a CAN user.

## Model (`src/core/`)
- `DataKind`: `frames` (raw bus frames), `signals` (named scalar values with a unit), `series` (time-ordered samples of one signal).
- `SourceDescriptor`: id, kind (`can-device`, `daq-device`, `log-file`, `simulator`), label and the kinds it `provides`.
- `SignalSource`: declared `SignalInfo` (name, unit, sample rate, factor/offset), `latest`, `subscribe`. `SignalBuffer` is the in-memory implementation that adapters push into; it drops samples for undeclared signals and non-finite values.
- `canSourceDescriptor`: the CAN device provides `frames` only. Scalar signals arrive with DBC decoding (#11).

## Panels
Every `PanelDef` declares `accepts` (a list of data kinds, or `'any'`). The dashboard shows only panels that accept something the active source provides. CAN panels (trace, channels, statistics, send frame, diagnostics) accept `frames`; the Device panel accepts `any`. `SignalsPanel` is the first generic panel and contains no product words.

## Not done here (needs decisions)
- DAQ device contract, sample rates, units and calibration model: firmware side.
- A contract/session layer interface next to `DeviceTransport` for a second product contract version.
- How product dashboards are chosen per device type and stored: depends on the dashboards issue (#16).
- Generic plot and gauge panels: #12 builds on this.

## Plot (#12, first slice)
The Plot panel appears once a database is loaded, because a loaded database makes the CAN source provide `signals` as well as `frames` (`canSourceDescriptor(state, hasDatabase)`). It follows decoded signals over time.

- **Data path:** `SeriesStore` reads rows of the trace buffer that arrived since its last call, decodes only the chosen signals (`decodeSelected`), and copies the samples into bounded ring buffers (`Series`, 60,000 points each). Samples stay when rows leave the trace buffer; rows evicted before they were read are counted (`missed`) and shown, never silent. The store starts over on Clear and when a database changes.
- **Drawing:** one lane per signal with its own scale and the unit from the database; shared device-clock time axis (seconds since the device's first frame, labelled as such). Per pixel column only the first, lowest, highest and last values are drawn, so cost follows the width of the plot, not the frame rate.
- **Not colour only:** every lane carries the signal name as text, and every series has its own line pattern and marker.
- **Accessible alternative:** a table with the latest value of each signal, or the value at the cursor (mouse or arrow keys), plus a CSV download of the visible window.
- **Measured target:** the plot's own JavaScript drawing stays under 8 ms (half of a 60 Hz frame). At about 1,800 frames/s with two lanes it measured 0.2 ms median (worst 0.4 ms) in Chromium. Reading new samples at about 9,000 frames/s with 8 signals took 0.1 ms median per update; reducing a 10 s window to pixel columns about 2 ms. GPU rasterisation, other browsers and a real device at full rate are not measured.
- **Limits:** up to 8 signals; fed from the CAN trace, not yet from a generic `SignalSource` (a DAQ source would need that connection); no zoom or per-lane cursors yet; the Capture page switches to a scrolling layout (trace, plot, working panels) while a Plot is shown, until panel layouts (#26) are redesigned.

## Layout: Trace splitter (#26, first slice)
A `role="separator"` on the edge under the Trace changes how much of the Capture window the Trace takes (25% to 80%). Drag it, or focus it: arrow keys change it in 5% steps, Home and End go to the limits, Enter (or double-click) removes the override and restores the original layout exactly. The value is remembered in this browser (`bw.layout.capture.split`); anything unusable is ignored. With nothing saved there is no override at all. In the Plot layout the Trace row has a 260 px floor. Hidden on phones. Moves, presets and side-by-side layouts are the next slices (see #26).
