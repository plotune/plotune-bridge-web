# Recording (#14, first slice)

Record the active device's frames to a file from the Trace toolbar (**Record as** a format, **Record**, then **Stop and save**). The file is built in this browser and saved with a download. Nothing is uploaded.

## Why it does not read the Trace
The Trace buffer holds 20,000 rows per device and evicts older ones. A recording that read from it would lose frames on any long capture. The recorder is a `StreamTap` on the device's frame stream (`WorkspaceStore.taps`), so it sees every frame in order, together with the device's drop reports. A browser test records more frames than the Trace can hold and checks the file has all of them.

## Formats
| Format | Notes | Checked with |
| --- | --- | --- |
| ASC (Vector text) | Header, device-clock timestamps from the first recorded frame, Rx/Tx, `x` after extended ids, remote frames, `CANFD` lines with BRS/ESI and the full FD payload, `//` comment where the device reported lost frames | `python-can` 4.6.1 `ASCReader`: ids, extended flag, remote, FD flags, data, direction, two channels, times. Not opened in a Vector tool. |
| BLF (Vector binary) | Zlib containers of Classic CAN message objects (48 bytes) and CAN FD `CAN_FD_MESSAGE_64` objects (136 bytes, full 64-byte data field); see below | python-can 4.6.1 reader and writer |
| candump log | `(time) canN ID#DATA`, device channel n is `can(n-1)`, 8-digit extended ids, `#R` for remote frames, `##flags` for CAN FD. No place for a drop note. **It has no Rx/Tx field**, so a candump export is lossy for direction (see below). | `python-can` 4.6.1 `CanutilsLogReader` |
| CSV | `time_s,channel,id_hex,extended,direction,remote,dlc,data_hex`. No place for a drop note. If an FD frame is recorded, the header and all rows gain `fd,brs,esi` (earlier Classic rows get `0,0,0`); a recording with no FD frame stays byte-identical to the Classic output. | Python `csv` |

Frames the device reported lost are always counted in the status line and in the saved summary; in formats that cannot carry a note the summary says so (use ASC).

## Field-by-field export matrix (BR-CAN-037 rev 3)

The source record is the device's `CanFrame`: `channel` (1/2), 11/29-bit `id` and `extended`, `fd`/`brs`/`esi`, `rtr`, `dlc`, full `data`, `direction` (`rx`/`tx`) and the device monotonic `timestampNs`. The table below is the contract for each exporter. **All exporters keep full payloads: there is no 8-byte FD truncation and no FD frame is labelled as Classical.**

| Format | Identifier / IDE | FD / BRS / ESI | Direction | Channel | Payload and DLC | Timestamp representation | Timebase / epoch | Precision | Unsupported mandatory fields |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **candump** | `ID` hex: 3 digits = standard, 8 digits = extended; IDE is inferred from the digit count | `#` = Classical; `##<flags>` = FD. Flags nibble bit 0 = BRS, bit 1 = ESI. FD itself is the `##` marker | **Not represented** | `can{channel-1}` (`can0`, `can1`) | Full uppercase hex, no separators; RTR is `#R` with **no requested length**. Data-frame DLC is not stored separately; for FD it is recoverable from the payload length, for RTR the requested length is **not stored** | `(<s>.<us>)` relative to the first recorded frame, 6 decimal places | Device monotonic, relative to the first recorded frame; the absolute device origin and wall clock are not stored | 1 µs (ns truncated to 6 decimals) | **direction (Rx/Tx)** always; **RTR requested length (DLC)** when a remote frame is recorded. Default export refuses; explicit lossy opt-in names the affected fields |
| **ASC** | Uppercase hex with no fixed width; `x` suffix = extended; IDE is the `x` | `CANFD` line = FD; BRS and ESI are separate `0`/`1` fields. Classical lines use `d` (data) or `r` (remote) | `Rx` / `Tx` | `1` / `2` | Full uppercase hex; FD payload length is a separate field; DLC code is decimal for Classical and hex for FD; no truncation | `<s>.<us>` relative to the first recorded frame, 6 decimal places; the header also has a browser wall-clock start time with ms precision | Device monotonic, relative to the first recorded frame; the header start is the browser time, not the device origin | 1 µs for frame times; 1 ms for the header wall-clock start | None (the relative device timebase is the documented representation) |
| **BLF** | 11/29-bit `id`; `CAN_MSG_EXT` (`0x80000000`) marks extended; `is_extended_id` reads the bit | Object type 1 (Classic) vs 101 (`CAN_FD_MESSAGE_64`). FD flag `0x1000`; BRS `0x2000`; ESI `0x4000` | Classic: flags bit `0x01`; FD: `dir` uint8 at object offset 66 (0 = Rx, 1 = Tx) | 1 / 2 (Classic uint16, FD uint8) | Classic 8-byte data field; FD 64-byte data field at offset 72 with `validBytes` at offset 34; no truncation. DLC at Classic offset 35 / FD offset 33 | Object timestamp is a uint64 nanosecond count relative to the first recorded frame; `TIME_ONE_NANS`. Header start/stop are wall-clock UTC with ms precision | Device monotonic, relative to the first recorded frame; the header wall clock is the browser time, not the device origin | 1 ns in the object; 1 ms for the header wall-clock start/stop. python-can exposes an absolute float, so readback comparisons use the documented relative conversion | None |
| **CSV** | `id_hex` uppercase; IDE is the `extended` `0`/`1` column | `fd`, `brs`, `esi` `0`/`1` columns. They are present once the recording contains an FD frame; a pure-Classical recording keeps the old header (all flags are false) | `rx` / `tx` | `1` / `2` | Full uppercase `data_hex`; `remote` `0`/`1`; `dlc` is the DLC code; no truncation | `time_s` `<s>.<us>` relative to the first recorded frame, 6 decimal places | Device monotonic, relative to the first recorded frame; no wall clock or absolute device origin is stored | 1 µs (ns truncated to 6 decimals) | None |

**Timebase rule.** Every export converts the device's monotonic nanosecond timestamp into time relative to the first recorded frame. The absolute device-origin value is not stored as an absolute field; the wall-clock start in ASC/BLF is the browser's clock at recording start, not the device clock. Comparisons must convert between these units and must not expect bit-identical values across different timebases; the accepted comparison tolerance is the documented precision above.

**Reader note.** python-can 4.6.1's `ASCReader` labels a zero-length FD line as remote. FD cannot be remote, so the independent ASC check compares `remote` for Classical/RTR frames only; this is a reader heuristic, not an export field loss. ASC still carries the FD flag and the zero-length payload.

**Loss policy.** `candump` cannot carry direction, and its `#R` marker does not carry the requested length of a Classical remote frame. If a candump recording contains any frames, `Stop and save` does **not** create a file; it shows a dialog naming `direction (Rx/Tx)` (and, when a remote frame was recorded, `RTR requested length (DLC)`). Cancel keeps the recording running; **Export anyway (lossy: …)** is the explicit opt-in, and the saved summary also names the dropped fields. ASC, BLF and CSV represent every mandatory field, so they export without a prompt. Classical ASC/BLF/CSV output is unchanged; candump's file syntax is unchanged but the previous silent loss is now refused by default.

**Independent readback.** `npm run verify:recording-fields` generates one fixture set through the actual writers, then reads ASC/candump/BLF with python-can and CSV with Python `csv`, comparing every representable field and the relative timestamps within the documented precision. Use the Nexus venv without installing anything:

```bash
PYTHON=/var/lib/plotune-nexus/worktrees/br-can-lead/plotune-nexus-core/packages/plotune_nexus_api/.venv/bin/python \
  npm run verify:recording-fields
```

The script documents the intentional candump differences: direction is absent, and a remote frame's requested length is absent (`#R` carries no length); the other representable fields are compared exactly. The fixture includes Classic Std/Ext/RTR and FD Std/Ext frames with BRS/ESI, 0/8/12/64-byte payloads, and ns-level timestamp offsets.

## Limits
- One device at a time (the active device when recording starts).
- Held in memory with a 64 MB cap, after which the recording stops writing and says so. Streaming to disk (File System Access API, Chromium only) is the next slice, then BLF.
- Timestamps are the device clock relative to the first recorded frame, not wall-clock time. Error frames are not recorded (the contract does not define them).

## BLF (added after the first slice)
BLF (Vector binary) is written in the browser: Classic CAN message objects (48 bytes each) and CAN FD `CAN_FD_MESSAGE_64` objects (136 bytes each) packed into zlib containers of up to 128 KiB (`CompressionStream('deflate')` is zlib format), with the 144-byte `LOGG` header. Object timestamps are nanoseconds from the first recorded frame; the header start time is the moment recording began (UTC). Like candump and CSV it cannot carry a note about lost frames.

The FD object follows python-can 4.6.1's `CAN_FD_MSG_64_STRUCT = <BBBBLLLLLLLHBBL`: channel, DLC, valid bytes, tx count, id, frame length, FD flags, arbitration/data bit-rate fields, BRS/CRC time offsets, a **uint16 bit count at object offset 64**, a **uint8 direction at offset 66**, a **uint8 extDataOffset at offset 67**, a **uint32 CRC at offset 68**, then the 64-byte data field at offset 72. Direction is 0 for Rx and 1 for Tx.

Verified with python-can 4.6.1: `BLFReader` reads a 9,005-message Classic file with the right ids, extended and remote flags, direction, data and times, and the decompressed container content is **byte-identical** to the content python-can's own `BLFWriter` produces for the same frames. Where the browser has no `CompressionStream` (before 2023 releases) the BLF option is not offered. Padding follows python-can (`obj_size % 4`). **Not opened in a Vector tool**: that needs you.

The FD object was also round-tripped independently with python-can from a BLF written by this module: a Std 12-byte Tx with BRS and an Ext 64-byte Rx with ESI both read back with the right `is_rx`, `is_fd`, `bitrate_switch`, `error_state_indicator`, id and data. The command is in the PR notes; it uses the Nexus venv, no new dependency.
