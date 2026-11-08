"""Independent readback of the Bridge Web recording exports.

Reads the fixtures written by scripts/verify-recording-fields.mjs with python-can (ASC, candump,
BLF) and Python's csv module, then compares every representable field with the device-origin
manifest. Timestamps are compared after conversion to the documented relative device timebase,
within the documented precision; they are never compared bit-for-bit across units.
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

from can import ASCReader, BLFReader
from can.io.canutils import CanutilsLogReader


def main() -> int:
    out = Path(sys.argv[1])
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    frames = manifest["frames"]
    formats = manifest["formats"]
    failures: list[str] = []

    def check(name: str, index: int, field: str, got, want) -> None:
        if got != want:
            failures.append(f"{name}[{index}].{field}: got {got!r}, want {want!r}")

    def check_time(name: str, index: int, got: float, want_ns: str, tolerance: float) -> None:
        want = int(want_ns) / 1e9
        if abs(got - want) > tolerance:
            failures.append(f"{name}[{index}].timestamp: got {got!r}s, want {want!r}s (tolerance {tolerance}s)")

    def check_length(name: str, got: int) -> None:
        if got != len(frames):
            failures.append(f"{name}: read {got} frames, expected {len(frames)}")

    # ASC ---------------------------------------------------------------------------------
    asc = list(ASCReader(str(out / "fixture.asc")))
    check_length("ASC", len(asc))
    first_asc = asc[0].timestamp if asc else 0.0
    for i, (message, expected) in enumerate(zip(asc, frames)):
        check("ASC", i, "id", message.arbitration_id, expected["id"])
        check("ASC", i, "extended", message.is_extended_id, expected["extended"])
        # FD cannot be remote. python-can's ASCReader treats an FD line with data length 0 as
        # remote; that is a reader heuristic, not an export field. Classic/RTR is compared.
        if not expected["fd"]:
            check("ASC", i, "remote", message.is_remote_frame, expected["remote"])
        check("ASC", i, "fd", message.is_fd, expected["fd"])
        check("ASC", i, "brs", message.bitrate_switch, expected["brs"])
        check("ASC", i, "esi", message.error_state_indicator, expected["esi"])
        check("ASC", i, "direction", message.is_rx, expected["direction"] == "rx")
        check("ASC", i, "channel", message.channel + 1, expected["channel"])
        check("ASC", i, "payload", bytes(message.data).hex(), expected["dataHex"])
        if not expected["fd"]:
            check("ASC", i, "dlc", message.dlc, expected["dlc"])
        else:
            # python-can exposes the FD payload length in Message.dlc; the DLC code is in the line.
            check("ASC", i, "fd payload length", message.dlc, len(bytes.fromhex(expected["dataHex"])))
        check_time("ASC", i, message.timestamp - first_asc, expected["relativeNs"], formats["asc"]["precisionSeconds"] + 1e-12)

    # candump -----------------------------------------------------------------------------
    log = list(CanutilsLogReader(str(out / "fixture.log")))
    check_length("candump", len(log))
    for i, (message, expected) in enumerate(zip(log, frames)):
        channel = message.channel if isinstance(message.channel, str) else f"can{message.channel}"
        check("candump", i, "id", message.arbitration_id, expected["id"])
        check("candump", i, "extended", message.is_extended_id, expected["extended"])
        check("candump", i, "remote", message.is_remote_frame, expected["remote"])
        check("candump", i, "fd", message.is_fd, expected["fd"])
        check("candump", i, "brs", message.bitrate_switch, expected["brs"])
        check("candump", i, "esi", message.error_state_indicator, expected["esi"])
        check("candump", i, "channel", channel, f"can{expected['channel'] - 1}")
        check("candump", i, "payload", bytes(message.data).hex(), expected["dataHex"])
        # Direction is the one documented lossy field: candump has no Rx/Tx marker.
        check_time("candump", i, message.timestamp, expected["relativeNs"], formats["candump"]["precisionSeconds"] + 1e-12)

    # BLF ---------------------------------------------------------------------------------
    reader = BLFReader(str(out / "fixture.blf"))
    blf = list(reader)
    check_length("BLF", len(blf))
    for i, (message, expected) in enumerate(zip(blf, frames)):
        check("BLF", i, "id", message.arbitration_id, expected["id"])
        check("BLF", i, "extended", message.is_extended_id, expected["extended"])
        check("BLF", i, "remote", message.is_remote_frame, expected["remote"])
        check("BLF", i, "fd", message.is_fd, expected["fd"])
        check("BLF", i, "brs", message.bitrate_switch, expected["brs"])
        check("BLF", i, "esi", message.error_state_indicator, expected["esi"])
        check("BLF", i, "direction", message.is_rx, expected["direction"] == "rx")
        check("BLF", i, "channel", message.channel + 1, expected["channel"])
        check("BLF", i, "payload", bytes(message.data).hex(), expected["dataHex"])
        if not expected["fd"]:
            check("BLF", i, "dlc", message.dlc, expected["dlc"])
        else:
            # python-can exposes the FD payload length in Message.dlc; the DLC code is at object offset 33.
            check("BLF", i, "fd payload length", message.dlc, len(bytes.fromhex(expected["dataHex"])))
        check_time("BLF", i, message.timestamp - reader.start_timestamp, expected["relativeNs"], formats["blf"]["precisionSeconds"] + 1e-12)

    # CSV ---------------------------------------------------------------------------------
    with (out / "fixture.csv").open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    check_length("CSV", len(rows))
    for i, (row, expected) in enumerate(zip(rows, frames)):
        check("CSV", i, "id", int(row["id_hex"], 16), expected["id"])
        check("CSV", i, "extended", int(row["extended"]), int(expected["extended"]))
        check("CSV", i, "direction", row["direction"], expected["direction"])
        check("CSV", i, "remote", int(row["remote"]), int(expected["remote"]))
        check("CSV", i, "dlc", int(row["dlc"]), expected["dlc"])
        check("CSV", i, "payload", row["data_hex"], expected["dataHex"].upper())
        check("CSV", i, "fd", int(row["fd"]), int(expected["fd"]))
        check("CSV", i, "brs", int(row["brs"]), int(expected["brs"]))
        check("CSV", i, "esi", int(row["esi"]), int(expected["esi"]))
        check("CSV", i, "channel", int(row["channel"]), expected["channel"])
        check_time("CSV", i, float(row["time_s"]), expected["relativeNs"], formats["csv"]["precisionSeconds"] + 1e-12)

    if failures:
        print("\n".join(failures))
        return 1

    print(f"ASC: {len(asc)} frames; identifiers, IDE, FD/BRS/ESI, direction, channel, payload, DLC (Classical/RTR; FD payload length) and relative time OK")
    print("ASC: remote is compared for Classic/RTR only; python-can labels a zero-length FD line as remote, which FD cannot be")
    print(f"candump: {len(log)} frames; identifiers, IDE, FD/BRS/ESI, channel, payload and relative time OK; direction and a remote frame's requested length are the documented lossy fields")
    print(f"BLF: {len(blf)} frames; identifiers, IDE, FD/BRS/ESI, direction, channel, payload, DLC (Classical/RTR; FD payload length) and relative time OK (file ns, readback float at 1 us)")
    print(f"CSV: {len(rows)} frames; identifiers, IDE, FD/BRS/ESI, direction, remote, DLC, channel, payload and relative time OK")
    print(f"RECORDING FIELD MATRIX READBACK OK ({len(frames)} source frames)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
