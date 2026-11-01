import { describe, expect, it } from 'vitest';
import { SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, clampRatio, parseRatio, ratioForDrag, ratioForKey, splitVars } from '../src/layout/split';

describe('trace splitter', () => {
  it('keeps the ratio inside its limits', () => {
    expect([clampRatio(0), clampRatio(1), clampRatio(0.5)]).toEqual([SPLIT_MIN, SPLIT_MAX, 0.5]);
  });
  it('reads only a usable remembered ratio', () => {
    expect([parseRatio(null), parseRatio('abc'), parseRatio('0.1'), parseRatio('0.9'), parseRatio('NaN')]).toEqual([null, null, null, null, null]);
    expect(parseRatio('0.45')).toBe(0.45);
  });
  it('moves with the arrow keys, jumps with Home and End, resets with Enter, and ignores other keys', () => {
    expect(ratioForKey(0.6, 'ArrowDown')).toBeCloseTo(0.65, 9);
    expect(ratioForKey(0.6, 'ArrowUp')).toBeCloseTo(0.55, 9);
    expect(ratioForKey(0.78, 'ArrowDown')).toBe(SPLIT_MAX);
    expect(ratioForKey(0.27, 'ArrowUp')).toBe(SPLIT_MIN);
    expect([ratioForKey(0.5, 'Home'), ratioForKey(0.5, 'End'), ratioForKey(0.3, 'Enter')]).toEqual([SPLIT_MIN, SPLIT_MAX, 'reset']);
    expect(ratioForKey(0.5, 'a')).toBeNull();
  });
  it('turns a drag into a ratio relative to the reference height, within limits', () => {
    expect(ratioForDrag(0.5, 100, 500)).toBeCloseTo(0.7, 9);
    expect(ratioForDrag(0.5, -1000, 500)).toBe(SPLIT_MIN);
    expect(ratioForDrag(0.5, 50, 0)).toBe(0.5);
  });
  it('changes nothing until a ratio exists, and matches the old layout at the default', () => {
    expect(splitVars(null)).toBeUndefined();
    expect(splitVars(SPLIT_DEFAULT)).toEqual({ '--row1': '60.0fr', '--row2': '40.0fr', '--trace-h': '38.0vh' });
  });
});
