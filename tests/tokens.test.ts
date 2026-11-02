import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
/** A token's colour, following aliases (var(--other)) to the hex value. */
const token = (name: string, depth = 0): string => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6}|var\\(--([a-z-]+)\\))`));
  if (!m || depth > 4) throw new Error(`token --${name} is missing or not a colour`);
  return m[2] ? token(m[2], depth + 1) : m[1];
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Every foreground/background pair the stylesheet puts text on. WCAG AA for normal text is 4.5:1.
const PAIRS: [string, string, string][] = [
  ['color-ink', 'color-paper', 'page text'],
  ['color-ink', 'color-panel', 'panel text'],
  ['color-text', 'color-panel', 'table and notice text'],
  ['color-muted', 'color-paper', 'secondary text on the page'],
  ['color-muted', 'color-panel', 'secondary text on panels'],
  ['color-muted', 'color-chrome', 'table heads, toolbar and explorer labels'],
  ['color-muted', 'status-neutral-bg', 'neutral badge'],
  ['color-ink', 'color-neutral-tint', 'hover and pressed rows'],
  ['color-ink', 'color-accent-tint', 'selected row, channel 2 chip'],
  ['color-on-action', 'color-action', 'primary button'],
  ['color-on-action', 'color-action-hover', 'primary button, hover'],
  ['button-text', 'color-panel', 'secondary button'],
  ['button-text', 'button-hover-bg', 'secondary button, hover'],
  ['nav-text', 'color-chrome', 'canvas tab and explorer item'],
  ['icon-text', 'color-panel', 'icon button'],
  ['icon-text', 'color-chrome', 'icon button on the toolbar'],
  ['color-accent', 'color-panel', 'links and disclosure text'],
  ['color-accent', 'color-chrome', 'active tab text on the toolbar'],
  ['color-accent', 'color-accent-tint', 'selected state text'],
  ['color-teal-link-hover', 'color-panel', 'link, hover'],
  ['text-good', 'color-panel', 'success text'],
  ['text-good', 'status-good-bg', 'good badge'],
  ['text-bad', 'color-panel', 'error text'],
  ['text-bad', 'status-bad-bg', 'bad badge'],
  ['color-panel', 'text-bad', 'danger button'],
  ['text-warn', 'color-panel', 'warning text'],
  ['text-warn', 'status-warn-bg', 'warn badge and drop markers'],
];

describe('colour pairs meet WCAG AA (4.5:1) for the text they carry', () => {
  it.each(PAIRS)('%s on %s (%s)', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the chrome neutral: graphite for the action, one indigo for what is active', () => {
    expect(token('color-action')).toBe('#1d1d1f');
    expect(token('color-accent-bright')).toBe('#5b62a7'); // the logo's own colour
    // The old teal names are aliases now; none of them may hold a hue of its own again.
    for (const alias of ['color-teal', 'color-teal-hover', 'color-on-teal', 'color-violet', 'color-teal-tint', 'color-violet-tint']) {
      expect(css, alias).toMatch(new RegExp(`--${alias}:\\s*var\\(--`));
    }
    expect(css).not.toMatch(/#00796b|#26a69a/i);
  });
});
