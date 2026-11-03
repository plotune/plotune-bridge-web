// The dock layout of one canvas: a tree of splits and tab groups. Pure and immutable, so the UI re-renders from it and tests
// can check it without a browser. Nothing here knows about panels beyond their ids.

export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom';
export type Direction = 'row' | 'col';

export interface GroupNode {
  kind: 'group';
  id: string;
  tabs: string[];
  active: string;
}
export interface SplitNode {
  kind: 'split';
  id: string;
  dir: Direction;
  children: LayoutNode[];
  /** Shares of the space, one per child, summing to 1. */
  sizes: number[];
}
export type LayoutNode = GroupNode | SplitNode;

export const MIN_SHARE = 0.1;
export const MAX_DEPTH = 8;
export const MAX_PANELS_PER_CANVAS = 40;

let counter = 0;
/** A short id that is unique in this page session and very unlikely to collide with one restored from storage. */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export const group = (tabs: string[], active?: string, id = newId('g')): GroupNode => ({ kind: 'group', id, tabs, active: active && tabs.includes(active) ? active : tabs[0]! });
export function split(dir: Direction, children: LayoutNode[], sizes?: number[], id = newId('s')): SplitNode {
  const raw = sizes && sizes.length === children.length ? sizes : children.map(() => 1 / children.length);
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return { kind: 'split', id, dir, children, sizes: raw.map((s) => s / sum) };
}

export function panelsIn(node: LayoutNode | null, out: string[] = []): string[] {
  if (!node) return out;
  if (node.kind === 'group') out.push(...node.tabs);
  else node.children.forEach((c) => panelsIn(c, out));
  return out;
}

export function findGroup(node: LayoutNode | null, test: (g: GroupNode) => boolean): GroupNode | null {
  if (!node) return null;
  if (node.kind === 'group') return test(node) ? node : null;
  for (const c of node.children) {
    const hit = findGroup(c, test);
    if (hit) return hit;
  }
  return null;
}
export const groupOf = (node: LayoutNode | null, panelId: string): GroupNode | null => findGroup(node, (g) => g.tabs.includes(panelId));
export const groupById = (node: LayoutNode | null, id: string): GroupNode | null => findGroup(node, (g) => g.id === id);

/** Merges a split into its parent when both run the same way, and drops splits with a single child. */
export function normalize(node: LayoutNode | null): LayoutNode | null {
  if (!node || node.kind === 'group') return node;
  const kids: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const c = normalize(child);
    if (!c) return;
    const share = node.sizes[i] ?? 0;
    if (c.kind === 'split' && c.dir === node.dir) {
      c.children.forEach((cc, j) => { kids.push(cc); sizes.push(share * (c.sizes[j] ?? 0)); });
    } else {
      kids.push(c);
      sizes.push(share);
    }
  });
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0]!;
  return split(node.dir, kids, sizes, node.id);
}

/** Takes a panel out of the tree. Empty groups disappear and the space goes to their neighbours. */
export function removePanel(node: LayoutNode | null, panelId: string): LayoutNode | null {
  if (!node) return null;
  if (node.kind === 'group') {
    if (!node.tabs.includes(panelId)) return node;
    const tabs = node.tabs.filter((t) => t !== panelId);
    if (tabs.length === 0) return null;
    return { ...node, tabs, active: tabs.includes(node.active) ? node.active : tabs[0]! };
  }
  const kids: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    const r = removePanel(c, panelId);
    if (r) { kids.push(r); sizes.push(node.sizes[i] ?? 0); }
  });
  if (kids.length === 0) return null;
  return normalize(split(node.dir, kids, sizes, node.id));
}

/** Puts a panel into a group (centre) or beside it (an edge, which splits the group). */
export function insertPanel(node: LayoutNode | null, groupId: string, zone: DropZone, panelId: string): LayoutNode | null {
  if (!node) return group([panelId]);
  if (node.kind === 'group') {
    if (node.id !== groupId) return node;
    if (zone === 'center') return { ...node, tabs: [...node.tabs, panelId], active: panelId };
    const added = group([panelId]);
    const first = zone === 'left' || zone === 'top';
    return split(zone === 'left' || zone === 'right' ? 'row' : 'col', first ? [added, node] : [node, added], [0.5, 0.5]);
  }
  return { ...node, children: node.children.map((c) => insertPanel(c, groupId, zone, panelId) as LayoutNode) };
}

/**
 * Where a new panel goes so that every panel stays in view: beside or under the group with the most room, along its longer side.
 * `aspect` is the canvas' width over its height; the sizes of the splits give each group its share of the area.
 */
export function autoPlace(root: LayoutNode | null, aspect = 1.7): { groupId: string; zone: 'right' | 'bottom' } | null {
  if (!root) return null;
  let best: { groupId: string; zone: 'right' | 'bottom'; area: number } | null = null;
  const walk = (n: LayoutNode, w: number, h: number): void => {
    if (n.kind === 'group') {
      const area = w * h;
      if (!best || area > best.area + 1e-9) best = { groupId: n.id, zone: w >= h ? 'right' : 'bottom', area };
      return;
    }
    n.children.forEach((c, i) => (n.dir === 'row' ? walk(c, w * n.sizes[i]!, h) : walk(c, w, h * n.sizes[i]!)));
  };
  walk(root, aspect, 1);
  return best ? { groupId: (best as { groupId: string }).groupId, zone: (best as { zone: 'right' | 'bottom' }).zone } : null;
}

/** Moves a panel to a group or its edge. Dropping the only tab of a group onto itself is a no-op. */
export function movePanel(root: LayoutNode | null, panelId: string, groupId: string, zone: DropZone): LayoutNode | null {
  const source = groupOf(root, panelId);
  if (!source) return root;
  if (source.id === groupId && (zone === 'center' || source.tabs.length === 1)) return root;
  return normalize(insertPanel(removePanel(root, panelId), groupId, zone, panelId));
}

export function setActiveTab(node: LayoutNode | null, groupId: string, panelId: string): LayoutNode | null {
  if (!node) return node;
  if (node.kind === 'group') return node.id === groupId && node.tabs.includes(panelId) ? { ...node, active: panelId } : node;
  return { ...node, children: node.children.map((c) => setActiveTab(c, groupId, panelId) as LayoutNode) };
}

/** Moves the divider between child `index` and `index + 1` of a split by `delta` (a share of the split). Keeps every child above MIN_SHARE. */
export function resizeSplit(node: LayoutNode | null, splitId: string, index: number, delta: number): LayoutNode | null {
  if (!node || node.kind === 'group') return node;
  if (node.id === splitId) {
    const a = node.sizes[index];
    const b = node.sizes[index + 1];
    if (a === undefined || b === undefined) return node;
    const total = a + b;
    const next = Math.min(total - MIN_SHARE, Math.max(MIN_SHARE, a + delta));
    const sizes = node.sizes.slice();
    sizes[index] = next;
    sizes[index + 1] = total - next;
    return { ...node, sizes };
  }
  return { ...node, children: node.children.map((c) => resizeSplit(c, splitId, index, delta) as LayoutNode) };
}

/** A copy with fresh group and split ids, and panel ids mapped through `rename`. */
export function remap(node: LayoutNode | null, rename: (panelId: string) => string): LayoutNode | null {
  if (!node) return null;
  if (node.kind === 'group') {
    const tabs = node.tabs.map(rename);
    return group(tabs, rename(node.active));
  }
  return split(node.dir, node.children.map((c) => remap(c, rename) as LayoutNode), node.sizes);
}

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const idLike = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);

/**
 * Reads a layout from storage or an imported file. Only panel ids in `known` survive; everything else is dropped.
 * Returns null when nothing usable is left. Depth, size and count limits stop a hostile file from building a huge tree.
 */
export function parseLayout(input: unknown, known: ReadonlySet<string>): LayoutNode | null {
  const seen = new Set<string>();
  let count = 0;
  const walk = (v: unknown, depth: number): LayoutNode | null => {
    if (depth > MAX_DEPTH || !record(v)) return null;
    if (v.kind === 'group') {
      if (!Array.isArray(v.tabs)) return null;
      const tabs: string[] = [];
      for (const t of v.tabs) {
        if (!idLike(t) || !known.has(t) || seen.has(t) || count >= MAX_PANELS_PER_CANVAS) continue;
        seen.add(t);
        count += 1;
        tabs.push(t);
      }
      if (tabs.length === 0) return null;
      return group(tabs, typeof v.active === 'string' ? v.active : undefined, idLike(v.id) ? v.id : newId('g'));
    }
    if (v.kind === 'split' && (v.dir === 'row' || v.dir === 'col') && Array.isArray(v.children) && v.children.length <= 12) {
      const kids: LayoutNode[] = [];
      const sizes: number[] = [];
      v.children.forEach((c, i) => {
        const n = walk(c, depth + 1);
        if (!n) return;
        const raw = Array.isArray(v.sizes) ? v.sizes[i] : undefined;
        kids.push(n);
        sizes.push(typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 1);
      });
      if (kids.length === 0) return null;
      return normalize(split(v.dir, kids, sizes, idLike(v.id) ? v.id : newId('s')));
    }
    return null;
  };
  return walk(input, 0);
}
