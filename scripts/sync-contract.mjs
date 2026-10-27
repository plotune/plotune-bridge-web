#!/usr/bin/env node
// Copies the Bridge CAN device-contract JSON Schema and conformance fixture from a plotune-nexus checkout
// into ./contract and records where they came from. The drift check against plotune-nexus runs in that
// repository's CI, not here; `--verify` only proves the local copies still match what was recorded.
//
//   node scripts/sync-contract.mjs --from ../plotune-nexus     copy + record source commit and checksums
//   node scripts/sync-contract.mjs --verify                    check local files against contract/SOURCE.json
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractDir = join(root, 'contract');
const sourceFile = join(contractDir, 'SOURCE.json');
const SOURCE_REPO = 'plotune-nexus';
const SOURCE_BASE = 'plotune-bridge/plotune-bridge-can/contract';
// path inside the source repo's contract folder -> path inside ./contract
const FILES = {
  'schema/bridge-can-contract.v0.1.0.schema.json': 'schema/bridge-can-contract.v0.1.0.schema.json',
  'examples/session-v0.1.0.ndjson': 'examples/session-v0.1.0.ndjson',
};

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const args = process.argv.slice(2);

if (args.includes('--verify')) {
  const recorded = JSON.parse(readFileSync(sourceFile, 'utf8'));
  let bad = 0;
  for (const [file, expected] of Object.entries(recorded.files)) {
    const path = join(contractDir, file);
    const actual = existsSync(path) ? sha256(path) : 'missing';
    if (actual !== expected) {
      console.error(`MISMATCH ${file}\n  recorded ${expected}\n  actual   ${actual}`);
      bad += 1;
    }
  }
  if (bad) process.exit(1);
  console.log(`contract files match SOURCE.json (${Object.keys(recorded.files).length} files, from ${recorded.repo}@${recorded.commit.slice(0, 12)})`);
} else {
  const from = args[args.indexOf('--from') + 1];
  if (!args.includes('--from') || !from) {
    console.error('usage: sync-contract.mjs --from <path to a plotune-nexus checkout> | --verify');
    process.exit(2);
  }
  const srcRoot = resolve(from, SOURCE_BASE);
  if (!existsSync(srcRoot)) {
    console.error(`not a plotune-nexus checkout: ${srcRoot} does not exist`);
    process.exit(2);
  }
  const git = (...a) => execFileSync('git', ['-C', resolve(from), ...a], { encoding: 'utf8' }).trim();
  const dirty = git('status', '--porcelain', '--', SOURCE_BASE);
  if (dirty) {
    console.error(`refusing to sync: uncommitted changes under ${SOURCE_BASE}\n${dirty}`);
    process.exit(1);
  }
  const files = {};
  for (const [from_, to] of Object.entries(FILES)) {
    mkdirSync(dirname(join(contractDir, to)), { recursive: true });
    copyFileSync(join(srcRoot, from_), join(contractDir, to));
    files[to] = sha256(join(contractDir, to));
  }
  const schema = JSON.parse(readFileSync(join(contractDir, 'schema/bridge-can-contract.v0.1.0.schema.json'), 'utf8'));
  writeFileSync(
    sourceFile,
    JSON.stringify({ repo: SOURCE_REPO, path: SOURCE_BASE, commit: git('rev-parse', 'HEAD'), contractVersion: schema['x-contract-version'], files }, null, 2) + '\n',
  );
  console.log(`synced ${Object.keys(files).length} files from ${SOURCE_REPO}@${git('rev-parse', '--short', 'HEAD')} (contract ${schema['x-contract-version']})`);
}
