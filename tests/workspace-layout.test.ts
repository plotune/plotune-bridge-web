import { describe, expect, it } from 'vitest';
import { group, groupById, groupOf, insertPanel, movePanel, normalize, panelsIn, parseLayout, removePanel, resizeSplit, setActiveTab, split, type LayoutNode, type SplitNode } from '../src/workspace/layout';

const base = (): LayoutNode => split('row', [group(['trace'], undefined, 'g1'), split('col', [group(['plot'], undefined, 'g2'), group(['stats', 'send'], 'stats', 'g3')], [0.5, 0.5], 's2')], [0.6, 0.4], 's1');

describe('dock layout', () => {
  it('lists the panels in reading order', () => {
    expect(panelsIn(base())).toEqual(['trace', 'plot', 'stats', 'send']);
  });

  it('removing the last tab of a group gives its space to the neighbours', () => {
    const r = removePanel(base(), 'trace') as SplitNode;
    // The remaining column split replaces the whole tree.
    expect(r.kind).toBe('split');
    expect(r.dir).toBe('col');
    expect(r.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('removing from a group with several tabs keeps the group and moves the active tab', () => {
    const r = removePanel(base(), 'stats');
    expect(groupById(r, 'g3')?.tabs).toEqual(['send']);
    expect(groupById(r, 'g3')?.active).toBe('send');
  });

  it('removing the only panel leaves an empty canvas', () => {
    expect(removePanel(group(['trace']), 'trace')).toBeNull();
  });

  it('dropping on the centre adds a tab and makes it active', () => {
    const r = movePanel(base(), 'trace', 'g2', 'center');
    expect(groupById(r, 'g2')?.tabs).toEqual(['plot', 'trace']);
    expect(groupById(r, 'g2')?.active).toBe('trace');
    expect(groupOf(r, 'trace')?.id).toBe('g2');
  });

  it('dropping on an edge splits the target group', () => {
    const r = movePanel(base(), 'trace', 'g3', 'bottom');
    const g = groupOf(r, 'trace')!;
    expect(g.tabs).toEqual(['trace']);
    expect(panelsIn(r).sort()).toEqual(['plot', 'send', 'stats', 'trace']);
  });

  it('merges nested splits that run the same way', () => {
    const nested = split('row', [group(['a'], undefined, 'ga'), split('row', [group(['b'], undefined, 'gb'), group(['c'], undefined, 'gc')], [0.5, 0.5])], [0.5, 0.5]) as SplitNode;
    const n = normalize(nested) as SplitNode;
    expect(n.children).toHaveLength(3);
    expect(n.sizes[0]).toBeCloseTo(0.5);
    expect(n.sizes[1]).toBeCloseTo(0.25);
  });

  it('dropping the only tab of a group onto itself changes nothing', () => {
    const t = base();
    expect(movePanel(t, 'trace', 'g1', 'right')).toBe(t);
    expect(movePanel(t, 'trace', 'g1', 'center')).toBe(t);
  });

  it('keeps every share above the minimum when resizing', () => {
    const r = resizeSplit(base(), 's1', 0, -0.9) as SplitNode;
    expect(r.sizes[0]).toBeCloseTo(0.1);
    expect(r.sizes[1]).toBeCloseTo(0.9);
    const r2 = resizeSplit(base(), 's1', 0, 0.9) as SplitNode;
    expect(r2.sizes[1]).toBeCloseTo(0.1);
  });

  it('sets the active tab only for a tab the group holds', () => {
    expect(groupById(setActiveTab(base(), 'g3', 'send'), 'g3')?.active).toBe('send');
    expect(groupById(setActiveTab(base(), 'g3', 'trace'), 'g3')?.active).toBe('stats');
  });

  it('inserting into an empty canvas makes a first group', () => {
    const r = insertPanel(null, 'x', 'center', 'trace');
    expect(r?.kind).toBe('group');
  });
});

describe('reading a layout from storage', () => {
  const known = new Set(['trace', 'plot', 'stats']);
  it('keeps known panels and drops unknown ones', () => {
    const r = parseLayout({ kind: 'group', id: 'g1', tabs: ['trace', 'nope', 'plot'], active: 'plot' }, known);
    expect(r && r.kind === 'group' && r.tabs).toEqual(['trace', 'plot']);
  });

  it('does not allow a panel to appear twice', () => {
    const r = parseLayout({ kind: 'split', dir: 'row', sizes: [0.5, 0.5], children: [{ kind: 'group', tabs: ['trace'], active: 'trace' }, { kind: 'group', tabs: ['trace', 'plot'], active: 'plot' }] }, known);
    expect(panelsIn(r)).toEqual(['trace', 'plot']);
  });

  it('rejects junk and trees that are too deep', () => {
    expect(parseLayout(null, known)).toBeNull();
    expect(parseLayout({ kind: 'group', tabs: [], active: '' }, known)).toBeNull();
    let deep: unknown = { kind: 'group', tabs: ['trace'], active: 'trace' };
    for (let i = 0; i < 12; i += 1) deep = { kind: 'split', dir: i % 2 ? 'row' : 'col', sizes: [1, 1], children: [deep, { kind: 'group', tabs: [`p${i}`] }] };
    expect(parseLayout(deep, known)).toBeNull();
  });

  it('repairs bad sizes instead of failing', () => {
    const r = parseLayout({ kind: 'split', dir: 'row', sizes: [-1, 'x'], children: [{ kind: 'group', tabs: ['trace'], active: 'trace' }, { kind: 'group', tabs: ['plot'], active: 'plot' }] }, known) as SplitNode;
    expect(r.sizes[0]).toBeCloseTo(0.5);
  });
});
