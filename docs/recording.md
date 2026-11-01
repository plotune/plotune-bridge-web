# Recording (#14, first slice)

Record the active device's frames to a file from the Trace toolbar (**Record as** a format, **Record**, then **Stop and save**). The file is built in this browser and saved with a download. Nothing is uploaded.

## Why it does not read the Trace
The Trace buffer holds 20,000 rows per device and evicts older ones. A recording that read from it would lose frames on any long capture. The recorder is a `StreamTap` on the device's frame stream (`WorkspaceStore.taps`), so it sees every frame in order, together with the device's drop reports. A browser test records more frames than the Trace can hold and checks the file has all of them.

## Formats
| Format | Notes | Checked with |
| --- | --- | --- |
| ASC (Vector text) | Header, device-clock timestamps from the first recorded frame, Rx/Tx, `x` after extended ids, remote frames, `//` comment where the device reported lost frames | `python-can` 4.6.1 `ASCReader`: ids, extended flag, remote, data, direction, two channels, times. Not opened in a Vector tool. |
| candump log | `(time) canN ID#DATA`, device channel n is `can(n-1)`, 8-digit extended ids, `#R` for remote frames. No place for a drop note. | `python-can` 4.6.1 `CanutilsLogReader` |
| CSV | `time_s,channel,id_hex,extended,direction,remote,dlc,data_hex`. No place for a drop note. | Python `csv` |

Frames the device reported lost are always counted in the status line and in the saved summary; in formats that cannot carry a note the summary says so (use ASC).

## Limits
- One device at a time (the active device when recording starts).
- Held in memory with a 64 MB cap, after which the recording stops writing and says so. Streaming to disk (File System Access API, Chromium only) is the next slice, then BLF.
- Timestamps are the device clock relative to the first recorded frame, not wall-clock time. Error frames are not recorded (the contract does not define them).
