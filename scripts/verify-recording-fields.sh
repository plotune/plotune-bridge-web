#!/usr/bin/env bash
# Independent BR-CAN-037 recording-field check: actual Bridge Web writers -> python-can/csv readback.
# Set PYTHON to an interpreter with python-can (the Nexus dev venv has it). Nothing is installed.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/plotune-recording-fields.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

node "$root/scripts/verify-recording-fields.mjs" "$tmp"
"${PYTHON:-python3}" "$root/scripts/verify-recording-fields.py" "$tmp"
