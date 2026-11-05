// BWEB-042 rev 1 / O9 (WCAG 1.3.1, table semantics). These are the DOM conditions that produced
// axe "incomplete" results: an ARIA rowgroup with no owned rows, and a header-only <table>.
// The L3 axe scan (e2e/bweb-042-o9.spec.ts) is the check that would catch a regression here.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { DeviceHub } from '../src/state/hub';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import type { StoragePort } from '../src/workspace/project';
import { seededProject } from './helpers/project';
import { fakeSso } from './helpers/sso';

const browser = { family: 'chromium', name: 'Chrome', supported: true } as const;
afterEach(cleanup);

function memory(): StoragePort & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

/** The capture template contains both the Trace ARIA table and the Statistics <table>. */
function mount(): void {
  const hub = new DeviceHub(
    () => new WorkspaceStore(defaultEnv({ transportFactory: () => { throw new Error('no device'); }, queryPermission: async () => 'unknown', browser })),
    (fn) => fn(),
  );
  render(<App hub={hub} browser={browser} cloudSso={fakeSso()} project={seededProject(memory())} />);
}

describe('BWEB-042 r1 / O9: table row and header semantics', () => {
  it('the Statistics table is never header-only: every column header has a data cell', () => {
    mount();
    const table = screen.getByTestId('stats-table');
    const headers = table.querySelectorAll('thead th');
    expect(headers.length).toBeGreaterThan(1);
    for (const th of headers) expect(th.getAttribute('scope')).toBe('col');
    // Before the fix the tbody was empty, so no <th> had an associated data cell.
    const bodyCells = table.querySelectorAll('tbody td');
    expect(bodyCells.length).toBeGreaterThanOrEqual(1);
    expect(bodyCells[0]!.textContent).toMatch(/No statistics yet/);
    expect(bodyCells[0]!.getAttribute('colspan')).toBe(String(headers.length));
  });

  it('the Trace body rowgroup always owns a row, and the virtualised canvas is presentational', () => {
    mount();
    const trace = document.querySelector('.bw-trace')!;
    expect(trace.getAttribute('role')).toBe('table');
    const canvas = trace.querySelector('.bw-trace-canvas')!;
    expect(canvas.getAttribute('role'), 'the sizing wrapper is transparent to the ARIA table').toBe('presentation');
    const body = trace.querySelector('.bw-trace-scroll')!;
    expect(body.getAttribute('role')).toBe('rowgroup');
    // Before the fix the only child was an unroled div, so the rowgroup owned no rows.
    expect(body.querySelectorAll('[role="row"]').length).toBeGreaterThanOrEqual(1);
    const emptyRow = body.querySelector('[data-testid="trace-empty"]')!;
    expect(emptyRow.getAttribute('role')).toBe('row');
    expect(emptyRow.querySelector('[role="cell"]')?.textContent).toMatch(/No frames yet/);
  });
});
