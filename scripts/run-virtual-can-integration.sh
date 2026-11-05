#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEXUS_CAN_ROOT="${NEXUS_CAN_ROOT:-/workspace/plotune-nexus/plotune-bridge/plotune-bridge-can}"
ARTIFACT_DIR="${CAN_INTEGRATION_ARTIFACT_DIR:-$ROOT_DIR/.artifacts/can-integration}"
mkdir -p "$ARTIFACT_DIR"
PIDS=()

command -v node >/dev/null || { echo "node is required" >&2; exit 2; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 2; }
command -v uv >/dev/null || { echo "uv is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
command -v setsid >/dev/null || { echo "setsid is required" >&2; exit 2; }
[[ -x "$ROOT_DIR/node_modules/.bin/playwright" ]] || { echo "run npm ci before this script" >&2; exit 2; }
[[ -d "$NEXUS_CAN_ROOT/virtual-device" && -d "$NEXUS_CAN_ROOT/bench" ]] || { echo "Nexus CAN virtual-device and bench packages are required at $NEXUS_CAN_ROOT" >&2; exit 2; }
node -e 'const [major] = process.versions.node.split(".").map(Number); if (major < 22) process.exit(2)'
python3 - <<'PY'
import socket
for port in (19101, 19111, 19121, 19141, 19201, 19202, 19301, 19302):
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(('127.0.0.1', port))
        except OSError as exc:
            raise SystemExit(f'port {port} is already in use: {exc}')
PY

cleanup() {
  local pid
  for pid in "${PIDS[@]}"; do kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; done
  for pid in "${PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

start_virtual() {
  local name="$1" port="$2" rate="$3" capacity="$4" loopback="$5"
  (
    cd "$NEXUS_CAN_ROOT/virtual-device"
    args=(--profile prototype2 --transport ws --port "$port" --seed 0 --generate-hz "$rate")
    [[ "$capacity" == "default" ]] || args+=(--queue-capacity "$capacity")
    [[ "$loopback" == "none" ]] || args+=(--loopback "$loopback")
    exec setsid uv run plotune-bridge-can-virtual "${args[@]}"
  ) >"$ARTIFACT_DIR/$name.log" 2>&1 &
  PIDS+=("$!")
}

start_bench() {
  local name="$1" control_port="$2" bridge_port="$3" hosted_origin="${4:-}"
  (
    cd "$NEXUS_CAN_ROOT/bench"
    args=(--transport ws --port "$control_port" --bridge-port "$bridge_port")
    [[ -z "$hosted_origin" ]] || args+=(--ws-origin "$hosted_origin")
    exec setsid uv run plotune-bridge-can-generator "${args[@]}"
  ) >"$ARTIFACT_DIR/$name.log" 2>&1 &
  PIDS+=("$!")
}

start_virtual primary 19101 10 default echo
start_virtual overflow 19111 10000 4 none
start_virtual second 19121 10 default echo
start_virtual single 19141 10 default none
start_bench bench 19201 19202
start_bench hosted-origin 19301 19302 https://bridge.plotune.net

python3 - "${PIDS[@]}" <<'PY'
import socket, sys, time
ports = (19101, 19111, 19121, 19141, 19201, 19202, 19301, 19302)
pids = [int(v) for v in sys.argv[1:]]
deadline = time.monotonic() + 30
pending = set(ports)
while pending and time.monotonic() < deadline:
    for port in tuple(pending):
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.2):
                pending.remove(port)
        except OSError:
            pass
    if pending:
        import os
        for pid in pids:
            try:
                os.kill(pid, 0)
            except OSError:
                raise SystemExit(f'simulator launcher exited before readiness: pid {pid}')
        time.sleep(0.2)
if pending:
    raise SystemExit(f'simulator endpoints did not become ready: {sorted(pending)}')
PY

export BRIDGE_VIRTUAL_URL=ws://127.0.0.1:19101
export BRIDGE_OVERFLOW_URL=ws://127.0.0.1:19111
export BRIDGE_VIRTUAL2_URL=ws://127.0.0.1:19121
export BRIDGE_SINGLE_CHANNEL_URL=ws://127.0.0.1:19141
export BRIDGE_BENCH_CONTROL_URL=ws://127.0.0.1:19201
export BRIDGE_BENCH_URL=ws://127.0.0.1:19202
export BRIDGE_BENCH_ORIGIN_URL=ws://127.0.0.1:19302

cd "$ROOT_DIR"
E2E_PORT=4182 PLAYWRIGHT_JSON_OUTPUT_NAME="$ARTIFACT_DIR/playwright.json" npm run test:virtual -- --reporter=line,json 2>&1 | tee "$ARTIFACT_DIR/playwright.log"
node --input-type=module - "$ARTIFACT_DIR/playwright.json" <<'JS'
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let skipped = 0;
let failed = 0;
const visit = (suite) => {
  for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
    if (test.status === 'skipped') skipped++;
    if (test.status === 'unexpected' || test.status === 'timedOut') failed++;
  }
  for (const child of suite.suites ?? []) visit(child);
};
visit(report);
if (skipped || failed) {
  console.error(`virtual suite must have zero skips/failures; skipped=${skipped}, failed=${failed}`);
  process.exit(1);
}
const { execFileSync } = await import('node:child_process');
const { chromium } = await import('@playwright/test');
const path = await import('node:path');
const fs = await import('node:fs');
const evidenceDir = path.resolve(process.cwd(), 'docs/evidence/task027-can');
fs.mkdirSync(path.join(evidenceDir, 'servers'), { recursive: true });
fs.copyFileSync(process.argv[2], path.join(evidenceDir, 'playwright.json'));
fs.copyFileSync(path.join(process.cwd(), '.artifacts/can-integration/playwright.log'), path.join(evidenceDir, 'run.log'));
for (const name of ['primary', 'overflow', 'second', 'single', 'bench', 'hosted-origin']) {
  fs.copyFileSync(path.join(process.cwd(), `.artifacts/can-integration/${name}.log`), path.join(evidenceDir, 'servers', `${name}.log`));
}
const browserVersion = execFileSync(chromium.executablePath(), ['--version'], { encoding: 'utf8' }).trim();
const packageVersion = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'node_modules/@playwright/test/package.json'), 'utf8')).version;
const nexusSha = execFileSync('git', ['-C', '/workspace/plotune-nexus', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const allSpecs = [];
const visitSpecs = (suite) => {
  for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) allSpecs.push({ title: spec.title, status: test.status });
  for (const child of suite.suites ?? []) visitSpecs(child);
};
visitSpecs(report);
fs.writeFileSync(path.join(evidenceDir, 'run.json'), JSON.stringify({
  started_at: report.stats.startTime,
  duration_ms: report.stats.duration,
  result: 'passed',
  actor: 'Codex execution agent (/root/simulator_planning)',
  maturity: 'L3 software integration evidence',
  tests: report.stats.expected,
  skipped: report.stats.skipped,
  failures: report.stats.unexpected,
  flaky: report.stats.flaky,
  scenario_results: allSpecs,
  command: 'npm run test:virtual:can',
  web_preview_port: 4182,
  nexus_source_commit: nexusSha,
  runtime: { node: process.version, playwright: packageVersion, browser: browserVersion },
  endpoints: {
    primary: process.env.BRIDGE_VIRTUAL_URL,
    overflow: process.env.BRIDGE_OVERFLOW_URL,
    second: process.env.BRIDGE_VIRTUAL2_URL,
    fresh: process.env.BRIDGE_SINGLE_CHANNEL_URL,
    bench_control: process.env.BRIDGE_BENCH_CONTROL_URL,
    bench_bridge: process.env.BRIDGE_BENCH_URL,
    hosted_origin_bridge: process.env.BRIDGE_BENCH_ORIGIN_URL
  },
  fixture: { seed: 0, classical_can_only: true, primary_rate_hz: 10, overflow_rate_hz: 10000, overflow_queue_capacity: 4, bench_bitrate_bps: 1000000 },
  requirements: ['BR-WEB-001 rev2 local only', 'BR-WEB-002 rev1', 'BR-WEB-003 rev1', 'BR-WEB-004 rev2', 'BR-WEB-006 rev2 local origin only', 'BWEB-043 rev2 partial UX'],
  limitations: ['software models only; no physical timing/electrical or hardware evidence', 'CAN FD unsupported: can_fd=false; no live FD validation', 'browser native local-network permission prompt not automated']
}, null, 2) + '\n');
JS
