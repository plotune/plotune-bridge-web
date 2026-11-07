# Recording (#14, first slice)

Record the active device's frames to a file from the Trace toolbar (**Record as** a format, **Record**, then **Stop and save**). The file is built in this browser and saved with a download. Nothing is uploaded.

## Why it does not read the Trace
The Trace buffer holds 20,000 rows per device and evicts older ones. A recording that read from it would lose frames on any long capture. The recorder is a `StreamTap` on the device's frame stream (`WorkspaceStore.taps`), so it sees every frame in order, together with the device's drop reports. A browser test records more frames than the Trace can hold and checks the file has all of them.

## Formats
| Format | Notes | Checked with |
| --- | --- | --- |
| ASC (Vector text) | Header, device-clock timestamps from the first recorded frame, Rx/Tx, `x` after extended ids, remote frames, `CANFD` lines with BRS/ESI and the full FD payload, `//` comment where the device reported lost frames | `python-can` 4.6.1 `ASCReader`: ids, extended flag, remote, FD flags, data, direction, two channels, times. Not opened in a Vector tool. |
| BLF (Vector binary) | Zlib containers of Classic CAN message objects (48 bytes) and CAN FD `CAN_FD_MESSAGE_64` objects (136 bytes, full 64-byte data field); see below | python-can 4.6.1 reader and writer |
| candump log | `(time) canN ID#DATA`, device channel n is `can(n-1)`, 8-digit extended ids, `#R` for remote frames, `##flags` for CAN FD. No place for a drop note. | `python-can` 4.6.1 `CanutilsLogReader` |
| CSV | `time_s,channel,id_hex,extended,direction,remote,dlc,data_hex`. No place for a drop note. If an FD frame is recorded, the header and all rows gain `fd,brs,esi` (earlier Classic rows get `0,0,0`); a recording with no FD frame stays byte-identical to the Classic output. | Python `csv` |

Frames the device reported lost are always counted in the status line and in the saved summary; in formats that cannot carry a note the summary says so (use ASC).

## Limits
- One device at a time (the active device when recording starts).
- Held in memory with a 64 MB cap, after which the recording stops writing and says so. Streaming to disk (File System Access API, Chromium only) is the next slice, then BLF.
- Timestamps are the device clock relative to the first recorded frame, not wall-clock time. Error frames are not recorded (the contract does not define them).

## BLF (added after the first slice)
BLF (Vector binary) is written in the browser: Classic CAN message objects (48 bytes each) and CAN FD `CAN_FD_MESSAGE_64` objects (136 bytes each) packed into zlib containers of up to 128 KiB (`CompressionStream('deflate')` is zlib format), with the 144-byte `LOGG` header. Object timestamps are nanoseconds from the first recorded frame; the header start time is the moment recording began (UTC). Like candump and CSV it cannot carry a note about lost frames.

The FD object follows python-can 4.6.1's `CAN_FD_MSG_64_STRUCT = <BBBBLLLLLLLHBBL`: channel, DLC, valid bytes, tx count, id, frame length, FD flags, arbitration/data bit-rate fields, BRS/CRC time offsets, a **uint16 bit count at object offset 64**, a **uint8 direction at offset 66**, a **uint8 extDataOffset at offset 67**, a **uint32 CRC at offset 68**, then the 64-byte data field at offset 72. Direction is 0 for Rx and 1 for Tx.

Verified with python-can 4.6.1: `BLFReader` reads a 9,005-message Classic file with the right ids, extended and remote flags, direction, data and times, and the decompressed container content is **byte-identical** to the content python-can's own `BLFWriter` produces for the same frames. Where the browser has no `CompressionStream` (before 2023 releases) the BLF option is not offered. Padding follows python-can (`obj_size % 4`). **Not opened in a Vector tool**: that needs you.

The FD object was also round-tripped independently with python-can from a BLF written by this module: a Std 12-byte Tx with BRS and an Ext 64-byte Rx with ESI both read back with the right `is_rx`, `is_fd`, `bitrate_switch`, `error_state_indicator`, id and data. The command is in the PR notes; it uses the Nexus venv, no new dependency.
