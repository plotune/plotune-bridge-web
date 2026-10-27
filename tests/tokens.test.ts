import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const token = (name: string): string => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} is missing or not a 6-digit hex colour`);
  return m[1];
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Every foreground/background pair app.css puts text on. WCAG AA for normal text is 4.5:1.
const PAIRS: [string, string, string][] = [
  ['color-ink', 'color-paper', 'page text'],
  ['color-ink', 'color-panel', 'panel text'],
  ['color-text', 'color-panel', 'table and notice text'],
  ['color-muted', 'color-paper', 'secondary text on the page'],
  ['color-muted', 'color-panel', 'secondary text on panels'],
  ['color-muted', 'color-chrome', 'table heads and navigation labels'],
  ['color-muted', 'status-neutral-bg', 'neutral badge'],
  ['color-ink', 'color-teal-tint', 'channel 1 chip, banners, session rows'],
  ['color-ink', 'color-violet-tint', 'channel 2 chip'],
  ['color-on-teal', 'color-teal', 'active navigation'],
  ['color-panel', 'color-teal', 'primary button'],
  ['color-panel', 'color-teal-hover', 'primary button, hover'],
  ['button-text', 'color-panel', 'secondary button'],
  ['button-text', 'button-hover-bg', 'secondary button, hover'],
  ['nav-text', 'color-chrome', 'navigation item'],
  ['icon-text', 'color-panel', 'icon button'],
  ['color-teal', 'color-panel', 'links and disclosure text'],
  ['color-teal', 'color-chrome', 'wordmark: product name in the top bar'],
  ['color-teal-link-hover', 'color-panel', 'link, hover'],
  ['text-good', 'color-panel', 'success text'],
  ['text-good', 'status-good-bg', 'good badge'],
  ['text-bad', 'color-panel', 'error text'],
  ['text-bad', 'status-bad-bg', 'bad badge'],
  ['color-panel', 'text-bad', 'danger button'],
  ['text-warn', 'color-panel', 'warning text'],
  ['text-warn', 'status-warn-bg', 'warn badge and drop markers'],
];

describe('brand colour pairs meet WCAG AA (4.5:1) for the text they carry', () => {
  it.each(PAIRS)('%s on %s (%s)', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("records why Stream's own badge text colours are not used: they fall below AA for small text", () => {
    expect(contrast(token('status-warn-fg'), token('status-warn-bg'))).toBeLessThan(4.5);
    expect(contrast(token('status-neutral-fg'), token('status-neutral-bg'))).toBeLessThan(4.5);
  });

  it('keeps every token a brand value from the vendored list (no new colours)', () => {
    const used = [...css.matchAll(/--[a-z-]+:\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => m[1].toLowerCase());
    expect(new Set(used).size).toBeGreaterThan(20);
    // Each colour line cites its plotune-web source (W:, I:, T: or stream.css:), so nothing here is invented.
    const colourLines = css.split('\n').filter((l) => /--[a-z-]+:\s*#[0-9a-fA-F]{6}/.test(l));
    for (const line of colourLines) expect(line, 'colour without a source citation').toMatch(/\/\*.*\b(W:|I:|T:|stream\.css:)/);
  });
});
