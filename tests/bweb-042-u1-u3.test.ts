// Bridge Web real-user findings U1 + U3 — CSS contract for the phone Trace layout.
// The visual result (real widths, a scrolling table, one tidy tool row) is measured in
// e2e/bweb-042-u1-u3.spec.ts with real Chromium at 390x844 and 1440x900. This test guards the
// CSS so a future edit cannot silently reintroduce the squeezed columns or the wrapping toolbar.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'app.css'), 'utf8');

/** The body of one @media block, found by balancing braces (the CSS has nested rules). */
function mediaBlock(query: string): string {
  const start = css.indexOf(`@media (${query})`);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return '';
}

const block = mediaBlock('max-width: 900px');

describe('U1 / U3: narrow Trace table and toolbar (CSS contract)', () => {
  it('U1: the narrow .bw-trace scrolls sideways inside its panel with a visible cue', () => {
    expect(block, 'a max-width:900px block exists').toBeTruthy();
    expect(block).toMatch(/\.bw-trace\s*\{[^}]*overflow-x:\s*auto/);
    expect(block).toMatch(/\.bw-trace\s*\{[^}]*scrollbar-width:\s*thin/s);
  });

  it('U1: header and scroll area share a readable minimum width', () => {
    expect(block).toMatch(/\.bw-trace-head,\s*\.bw-trace-scroll\s*\{[^}]*min-width:\s*620px/);
    expect(block).toMatch(/min-width:\s*760px/); // the has-name variant with the extra column
  });

  it('U1: a definite scroll hint is shown on phones and hidden on wide screens', () => {
    expect(css).toMatch(/\.bw-trace-scroll-hint\s*\{\s*display:\s*none/);
    // the phone rule (inside a max-width:640px block) turns it on
    expect(css).toMatch(/@media \(max-width: 640px\)\s*\{[^}]*\.bw-trace-scroll-hint\s*\{[^}]*display:\s*block/s);
  });

  it('U1: the narrow grid keeps a Type column and gives Data real room', () => {
    expect(block).toMatch(/grid-template-columns:\s*104px 72px 88px 92px 44px 40px minmax\(0,\s*1fr\)/);
    // Type used to be hidden below 900px; it must be a real column again.
    expect(block).not.toContain('.bw-trace-head .bw-c-type');
    expect(block).not.toMatch(/\.bw-c-type[\s\S]{0,120}display:\s*none/);
  });

  it('U3: the panel tools stay on one non-wrapping, scrollable row', () => {
    expect(block).toMatch(/\.bw-panel-tools\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(block).toMatch(/\.bw-panel-tools\s*\{[^}]*overflow-x:\s*auto/s);
    expect(block).toMatch(/\.bw-panel-tools\s*\{[^}]*flex:\s*1 1 100%/s);
  });
});
