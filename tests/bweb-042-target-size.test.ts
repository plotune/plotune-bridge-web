// BWEB-042 rev 1 / O10 (WCAG 2.5.8, Target Size (Minimum), 24 x 24 CSS px).
// The sidebar device control is a button, not a label, so its own box must be at least 24 px high.
// axe's target-size rule accepts an undersized control through the spacing exception, so the CSS
// minimum is guarded here and the real box is measured in e2e/bweb-042.spec.ts (L3, real Chromium).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'app.css'), 'utf8');

describe('BWEB-042 r1 / O10: sidebar device control target size', () => {
  it('the desktop .bw-device-select rule declares a min-height of at least 24 CSS px', () => {
    const rule = css.match(/\.bw-device-select\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule, 'the .bw-device-select rule exists').toBeTruthy();
    const minHeight = rule.match(/min-height:\s*(\d+(?:\.\d+)?)px/);
    expect(minHeight, 'the rule declares a min-height in px').not.toBeNull();
    expect(Number(minHeight![1])).toBeGreaterThanOrEqual(24);
  });
});
