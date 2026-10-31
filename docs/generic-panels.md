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
