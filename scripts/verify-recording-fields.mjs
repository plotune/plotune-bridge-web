// Generates one fixture recording through the real Bridge Web writers, plus a manifest of the
// device-origin source records for the independent python-can/csv readback.
//
// Run through scripts/verify-recording-fields.sh. The actual Recorder is loaded through Vite's
// SSR module graph so the script uses the same TypeScript sources as the browser build.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/verify-recording-fields.mjs <output-directory>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: false, appType: 'custom', server: { middlewareMode: true } });

const START = new Date(Date.UTC(2026, 10, 8, 12, 0, 0, 0));
const origin = (1n << 60n) + 12345n;
const bytes = (length, first = 0) => Uint8Array.from({ length }, (_, i) => (first + i) & 0xff);
const frame = (over) => ({ channel: 1, id: 0x123, extended: false, rtr: false, dlc: 0, data: new Uint8Array(), timestampNs: origin, direction: 'rx', ...over });

const frames = [
  frame({ id: 0x123, dlc: 8, data: bytes(8, 0x10), direction: 'rx' }),
  frame({ id: 0x18daf110, extended: true, dlc: 0, data: bytes(0), timestampNs: origin + 1n, direction: 'tx' }),
  frame({ id: 0x100, rtr: true, dlc: 5, data: bytes(0), timestampNs: origin + 999n, direction: 'rx' }),
  frame({ id: 0x200, fd: true, brs: true, esi: false, dlc: 9, data: bytes(12, 0x20), timestampNs: origin + 1_000n, direction: 'tx' }),
  frame({ id: 0x18da10f1, extended: true, fd: true, brs: true, esi: true, dlc: 15, data: bytes(64, 0x00), timestampNs: origin + 1_234_567n, direction: 'rx' }),
  frame({ id: 0x300, fd: true, brs: false, esi: false, dlc: 0, data: bytes(0), timestampNs: origin + 2_000_000_001n, direction: 'rx' }),
  frame({ id: 0x301, fd: true, brs: false, esi: true, dlc: 8, data: bytes(8, 0x40), timestampNs: origin + 3_000_000_000n, direction: 'tx' }),
];

const manifest = {
  startedAt: START.toISOString(),
  originNs: origin.toString(),
  note: 'Timestamps are relative to the first recorded frame. ASC/candump/CSV precision is 1 us; BLF file precision is 1 ns, with python-can float readback compared at 1 us. candump has no direction field and its #R carries no requested length (both documented losses).',
  formats: {
    asc: { precisionSeconds: 0.000001, direction: true },
    candump: { precisionSeconds: 0.000001, direction: false },
    blf: { precisionSeconds: 0.000001, direction: true },
    csv: { precisionSeconds: 0.000001, direction: true },
  },
  frames: frames.map((f) => ({
    channel: f.channel,
    id: f.id,
    extended: f.extended,
    remote: f.rtr,
    dlc: f.dlc,
    fd: f.fd === true,
    brs: f.brs === true,
    esi: f.esi === true,
    direction: f.direction,
    relativeNs: (f.timestampNs - origin).toString(),
    dataHex: Buffer.from(f.data).toString('hex'),
  })),
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

try {
  const { Recorder } = await server.ssrLoadModule('/src/record/recorder.ts');
  for (const format of ['asc', 'candump', 'csv']) {
    const recorder = new Recorder(format, START);
    for (const f of frames) recorder.frame(f);
    writeFileSync(join(out, `fixture.${format === 'candump' ? 'log' : format}`), recorder.text());
  }
  const blf = new Recorder('blf', START);
  for (const f of frames) blf.frame(f);
  writeFileSync(join(out, 'fixture.blf'), Buffer.from(await blf.blfBytes()));
  console.log(`wrote fixtures and manifest to ${out}`);
} finally {
  await server.close();
}
