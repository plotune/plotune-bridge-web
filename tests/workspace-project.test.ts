import { describe, expect, it } from 'vitest';
import { panelsIn } from '../src/workspace/layout';
import { defaultProject, parseProject, ProjectStore, PROJECTS_KEY, type StoragePort } from '../src/workspace/project';

function memory(initial: Record<string, string> = {}): StoragePort & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

describe('default project', () => {
  it('has the three canvases a first visit always had, each with panels', () => {
    const p = defaultProject();
    expect(p.canvases.map((c) => c.name)).toEqual(['Capture', 'Diagnostics', 'Device']);
    expect(panelsIn(p.canvases[0]!.root).map((id) => p.panels[id]!.type)).toEqual(['trace', 'plot', 'channels', 'stats', 'transmit']);
    expect(panelsIn(p.canvases[2]!.root).map((id) => p.panels[id]!.type)).toEqual(['device']);
  });
});

describe('canvases', () => {
  it('adds, renames, switches and duplicates', () => {
    const s = new ProjectStore(() => memory());
    const id = s.addCanvas('Night run', 'debug')!;
    expect(s.getState().project.active).toBe(id);
    s.renameCanvas(id, '  Cell 7 night run  ');
    expect(s.getState().project.canvases.at(-1)!.name).toBe('Cell 7 night run');
    const copy = s.duplicateCanvas(id)!;
    const p = s.getState().project;
    expect(p.canvases.map((c) => c.name).slice(-2)).toEqual(['Cell 7 night run', 'Cell 7 night run copy']);
    // The copy has its own panel instances.
    const a = panelsIn(p.canvases.find((c) => c.id === id)!.root);
    const b = panelsIn(p.canvases.find((c) => c.id === copy)!.root);
    expect(b).toHaveLength(a.length);
    expect(b.some((x) => a.includes(x))).toBe(false);
    s.setActive(p.canvases[0]!.id);
    expect(s.getState().project.active).toBe(p.canvases[0]!.id);
  });

  it('a blank canvas is empty and takes its first panel into a group', () => {
    const s = new ProjectStore(() => memory());
    s.addCanvas('Blank');
    expect(s.getState().project.canvases.at(-1)!.root).toBeNull();
    s.addPanel('trace');
    const c = s.getState().project.canvases.at(-1)!;
    expect(panelsIn(c.root)).toHaveLength(1);
  });

  it('deleting keeps one canvas, drops its panels and can be undone', () => {
    const s = new ProjectStore(() => memory());
    const before = Object.keys(s.getState().project.panels).length;
    const victim = s.getState().project.canvases[1]!;
    expect(s.deleteCanvas(victim.id)).toBe(true);
    expect(Object.keys(s.getState().project.panels).length).toBeLessThan(before);
    s.undoDeleteCanvas();
    expect(s.getState().project.canvases.map((c) => c.name)).toEqual(['Capture', 'Diagnostics', 'Device']);
    expect(Object.keys(s.getState().project.panels)).toHaveLength(before);
    const only = new ProjectStore(() => memory());
    only.deleteCanvas(only.getState().project.canvases[1]!.id);
    only.deleteCanvas(only.getState().project.canvases[1]!.id);
    expect(only.deleteCanvas(only.getState().project.canvases[0]!.id)).toBe(false);
  });

  it('moves a canvas left and right', () => {
    const s = new ProjectStore(() => memory());
    const id = s.getState().project.canvases[2]!.id;
    s.moveCanvas(id, -1);
    expect(s.getState().project.canvases.map((c) => c.name)).toEqual(['Capture', 'Device', 'Diagnostics']);
    s.moveCanvas(id, 1);
    s.moveCanvas(id, 1);
    expect(s.getState().project.canvases.at(-1)!.id).toBe(id);
  });
});

describe('persistence', () => {
  it('remembers the project and its changes', () => {
    const storage = memory();
    const a = new ProjectStore(() => storage);
    a.renameProject('Cell 7');
    a.addCanvas('Analysis', 'analysis');
    const b = new ProjectStore(() => storage);
    expect(b.getState().project.name).toBe('Cell 7');
    expect(b.getState().project.canvases.map((c) => c.name)).toContain('Analysis');
    expect(b.getState().project.active).toBe(a.getState().project.active);
  });

  it('keeps several projects and opens another one', () => {
    const storage = memory();
    const s = new ProjectStore(() => storage);
    const first = s.getState().project.id;
    s.renameProject('First');
    s.newProject('Second');
    expect(s.getState().projects.map((p) => p.name).sort()).toEqual(['First', 'Second']);
    expect(s.openProject(first)).toBe(true);
    expect(s.getState().project.name).toBe('First');
    expect(s.openProject('missing')).toBe(false);
  });

  it('starts clean when storage is damaged or unavailable', () => {
    expect(new ProjectStore(() => memory({ [PROJECTS_KEY]: '{not json' })).getState().project.canvases).toHaveLength(3);
    expect(new ProjectStore(() => null).getState().project.canvases).toHaveLength(3);
    expect(new ProjectStore(() => memory({ [PROJECTS_KEY]: JSON.stringify({ version: 1, projects: [] }) })).getState().project.canvases).toHaveLength(3);
  });

  it('keeps working in memory when saving fails, and says so', () => {
    const storage: StoragePort = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => undefined };
    const s = new ProjectStore(() => storage);
    s.renameProject('X');
    expect(s.getState().saveFailed).toBe(true);
    expect(s.getState().project.name).toBe('X');
  });
});

describe('import and export', () => {
  it('round-trips a project as a new project', () => {
    const a = new ProjectStore(() => memory());
    a.renameProject('Round trip');
    const text = a.exportJson();
    const b = new ProjectStore(() => memory());
    const r = b.importJson(text);
    expect(r).toEqual({ ok: true, name: 'Round trip' });
    expect(b.getState().project.id).not.toBe(a.getState().project.id);
    expect(b.getState().project.canvases.map((c) => c.name)).toEqual(['Capture', 'Diagnostics', 'Device']);
  });

  it('refuses files that are not projects, with a reason', () => {
    const s = new ProjectStore(() => memory());
    expect(s.importJson('nope')).toMatchObject({ ok: false });
    expect(s.importJson('{"version":9}')).toMatchObject({ ok: false });
    expect(s.importJson(JSON.stringify({ version: 2, canvases: [], panels: {} }))).toMatchObject({ ok: false });
  });

  it('drops panel types it does not know and panels no canvas uses', () => {
    const text = JSON.stringify({ version: 2, name: 'X', canvases: [{ id: 'c1', name: 'One', root: { kind: 'group', tabs: ['p1', 'p2'], active: 'p2' } }], panels: { p1: { type: 'trace' }, p2: { type: 'nope' }, p3: { type: 'plot' } } });
    const p = parseProject(JSON.parse(text))!;
    expect(Object.keys(p.panels)).toEqual(['p1']);
    expect(panelsIn(p.canvases[0]!.root)).toEqual(['p1']);
  });

  it('limits names to something that fits a tab', () => {
    const p = parseProject({ version: 2, name: 'N'.repeat(500), canvases: [{ id: 'c1', name: '\u0000x\u0001', root: null }], panels: {} })!;
    expect(p.name).toHaveLength(48);
    expect(p.canvases[0]!.name).toBe('x');
  });
});
