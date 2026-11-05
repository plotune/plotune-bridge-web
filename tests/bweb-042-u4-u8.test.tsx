// Bridge Web real-user findings U4 + U8 — the recording-format select and the recorded-file chip.
// L2: component DOM + CSS contract. The full hover text of the saved chip after a real recording
// is proven in e2e/bweb-042-u4-u8.spec.ts (L3, real Chromium).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { DeviceHub } from '../src/state/hub';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { FORMATS, formatSpec } from '../src/record/formats';
import type { StoragePort } from '../src/workspace/project';
import { seededProject } from './helpers/project';
import { fakeSso } from './helpers/sso';

const browser = { family: 'chromium', name: 'Chrome', supported: true } as const;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src', 'styles', 'app.css'), 'utf8');
afterEach(cleanup);

function memory(): StoragePort & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

function mount(): void {
  const hub = new DeviceHub(
    () => new WorkspaceStore(defaultEnv({ transportFactory: () => { throw new Error('no device'); }, queryPermission: async () => 'unknown', browser })),
    (fn) => fn(),
  );
  render(<App hub={hub} browser={browser} cloudSso={fakeSso()} project={seededProject(memory())} />);
}

describe('U4 + U8: recording-format select and recorded chip', () => {
  it('U4: every format keeps its full label and gains a shorter code', () => {
    expect(FORMATS.length).toBeGreaterThanOrEqual(3);
    for (const f of FORMATS) {
      expect(f.shortLabel.length, `${f.id} has a short code`).toBeLessThan(f.label.length);
      expect(f.label).toContain(f.shortLabel);
    }
    expect(formatSpec('asc').label).toBe('ASC (Vector text)');
  });

  it('U4: the select and every option carry the full label on title, but show a short code', () => {
    mount();
    const select = screen.getByLabelText('Recording format') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.getAttribute('title')).toContain('ASC (Vector text)');
    const options = [...select.options];
    expect(options.length).toBeGreaterThanOrEqual(3);
    for (const o of options) {
      expect(o.getAttribute('title'), 'full descriptive name on hover').toBeTruthy();
      expect(o.textContent, 'no long "(Vector text)" in the 76px control').not.toContain('(');
    }
    expect(select.options[select.selectedIndex]!.textContent).toBe('ASC');
  });

  it('U4: the phone top bar keeps the chooser and gives it a 44px target', () => {
    expect(css).toMatch(/\.bw-top-end \.bw-format-select\s*\{[^}]*min-height:\s*44px/);
    expect(css, 'the old blanket hide of top-bar selects is gone').not.toContain('.bw-top-end select');
  });

  it('U8: the status is ellipsised (so the full text must be on title)', () => {
    // The CSS still truncates at 240px; the fix is the title attribute on the span.
    expect(css).toMatch(/\.bw-record-status\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
});
