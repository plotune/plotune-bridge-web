// Bridge Web real-user finding U2 — the phone Statistics table is wider than its panel and the
// hidden columns need a definite cue. L2: DOM contract + CSS contract. The truthful behaviour of
// the data-more flag (only while columns are really hidden) is proven in e2e/bweb-042-u2.spec.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { DeviceHub } from '../src/state/hub';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import type { StoragePort } from '../src/workspace/project';
import { seededProject } from './helpers/project';
import { fakeSso } from './helpers/sso';

const browser = { family: 'chromium', name: 'Chrome', supported: true } as const;
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'app.css'), 'utf8');
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

describe('U2: Statistics table scroll affordance', () => {
  it('the wrap is a labelled, keyboard-focusable scroll region', () => {
    mount();
    const wrap = screen.getByRole('region', { name: 'Statistics by channel' });
    expect(wrap.getAttribute('tabindex')).toBe('0');
    expect(wrap.classList.contains('bw-table-wrap')).toBe(true);
    // The table is still a real table (O9 semantics are untouched by the hint).
    expect(screen.getByTestId('stats-table').tagName).toBe('TABLE');
  });

  it('the hint exists and names the columns that would otherwise look absent', () => {
    mount();
    const hint = screen.getByTestId('stats-scroll-hint');
    expect(hint.textContent).toContain('Scroll sideways');
    expect(hint.textContent).toContain('Sent');
    expect(hint.textContent).toContain('Send failed');
    expect(hint.textContent).toContain('Bus errors');
    // It is a sibling of the wrap, not inside the table.
    expect(hint.previousElementSibling?.classList.contains('bw-table-wrap')).toBe(true);
  });

  it('CSS: a thin bar, a truthful [data-more] hint rule, and an edge fade', () => {
    expect(css).toMatch(/\.bw-table-wrap\s*\{[^}]*scrollbar-width:\s*thin/s);
    expect(css).toMatch(/\.bw-table-wrap\[data-more='true'\]\s*\+\s*\.bw-table-scroll-hint\s*\{[^}]*display:\s*block/s);
    expect(css).toMatch(/\.bw-table-wrap\[data-more='true'\]\s*\{[^}]*mask-image:\s*linear-gradient/s);
    expect(css).toMatch(/\.bw-table-scroll-hint\s*\{[^}]*display:\s*none/s);
  });
});
