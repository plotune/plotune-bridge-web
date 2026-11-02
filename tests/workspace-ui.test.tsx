// The workspace as a user meets it: canvases, panels, workspaces, the command palette. No device is needed.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { DeviceHub } from '../src/state/hub';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { panelsIn } from '../src/workspace/layout';
import { ProjectStore, type StoragePort } from '../src/workspace/project';
import { fakeSso } from './helpers/sso';

const browser = { family: 'chromium', name: 'Chrome', supported: true } as const;
afterEach(cleanup);

function memory(): StoragePort & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}
function mount(storage = memory()) {
  const hub = new DeviceHub(() => new WorkspaceStore(defaultEnv({ transportFactory: () => { throw new Error('no device'); }, queryPermission: async () => 'unknown', browser })), (fn) => fn());
  const project = new ProjectStore(() => storage);
  render(<App hub={hub} browser={browser} cloudSso={fakeSso()} project={project} />);
  return { project, storage, hub };
}
const tabs = () => within(screen.getByRole('navigation', { name: 'Workspace' })).getAllByRole('button').map((b) => b.textContent);

describe('canvases', () => {
  it('start as the three pages a first visit always had', () => {
    mount();
    expect(tabs()).toEqual(['Capture', 'Diagnostics', 'Device', '+']);
    expect(screen.getByRole('button', { name: 'Capture' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'Trace' })).toBeVisible();
  });

  it('switch on a click, and each canvas shows its own panels', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Device' }));
    expect(screen.getByText('Not connected to a device.')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Trace' })).toBeNull();
  });

  it('can be added blank, filled with panels from the gallery, and named', () => {
    const { project } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'New canvas' }));
    const dialog = screen.getByRole('dialog', { name: 'New canvas' });
    fireEvent.change(within(dialog).getByLabelText('Canvas name'), { target: { value: 'Cell 7' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Blank canvas/ }));
    expect(tabs()).toContain('Cell 7');
    expect(screen.getByTestId('empty-canvas')).toBeVisible();
    fireEvent.click(within(screen.getByTestId('empty-canvas')).getByRole('button', { name: 'Add a panel' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add a panel' })).getByRole('button', { name: /^Statistics/ }));
    expect(screen.getByRole('region', { name: 'Statistics' })).toBeVisible();
    expect(panelsIn(project.getState().project.canvases.at(-1)!.root)).toHaveLength(1);
  });

  it('can be renamed by double-click, and renaming is refused when empty', () => {
    const { project } = mount();
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Diagnostics' }));
    const input = within(screen.getByRole('dialog', { name: 'Rename canvas' })).getByLabelText('Canvas name');
    fireEvent.change(input, { target: { value: 'ECU tests' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(tabs()).toContain('ECU tests');
    expect(project.getState().project.canvases[1]!.name).toBe('ECU tests');
    fireEvent.doubleClick(screen.getByRole('button', { name: 'ECU tests' }));
    const again = within(screen.getByRole('dialog', { name: 'Rename canvas' })).getByLabelText('Canvas name');
    fireEvent.change(again, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('can be deleted and brought back with Undo', async () => {
    mount();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Diagnostics' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete canvas/ }));
    expect(tabs()).not.toContain('Diagnostics');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(tabs()).toContain('Diagnostics'));
  });

  it('can be duplicated from the menu', () => {
    const { project } = mount();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Capture' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(tabs()).toContain('Capture copy');
    expect(project.getState().project.active).toBe(project.getState().project.canvases[1]!.id);
  });
});

describe('panels', () => {
  it('closing a panel from its tab removes it and keeps the rest', () => {
    mount();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Statistics' }), { key: 'Delete' });
    expect(screen.queryByRole('region', { name: 'Statistics' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Trace' })).toBeVisible();
  });

  it('can be renamed from the tab menu', () => {
    const { project } = mount();
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Channels' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename panel' });
    fireEvent.change(within(dialog).getByLabelText('Panel name'), { target: { value: 'Bus state' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('tab', { name: 'Bus state' })).toBeVisible();
    expect(Object.values(project.getState().project.panels).some((p) => p.name === 'Bus state')).toBe(true);
  });

  it('more than one panel of a type can be on a canvas, and the first keeps its familiar id', () => {
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a panel to this group' })[0]!);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add a panel' })).getByRole('button', { name: /^Trace/ }));
    expect(document.querySelectorAll('#panel-trace')).toHaveLength(1);
    expect(screen.getAllByRole('tab', { name: 'Trace' })).toHaveLength(2);
  });

  it('a tab group can be maximized and restored with Escape', () => {
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Maximize this group' })[0]!);
    // The other groups stay mounted (their state is kept) but cannot be reached.
    expect(screen.getByRole('region', { name: 'Statistics' }).closest('[inert]')).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Trace' }).closest('[inert]')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('region', { name: 'Statistics' }).closest('[inert]')).toBeNull();
  });

  it('tabs in a group move with the arrow keys', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'New canvas' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New canvas' })).getByRole('button', { name: /Transmit and test/ }));
    const stats = screen.getByRole('tab', { name: 'Statistics' });
    expect(stats).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(stats, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Channels' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a panel pointed at a device that is gone offers the selected device', () => {
    const { project } = mount();
    const pid = Object.entries(project.getState().project.panels).find(([, p]) => p.type === 'channels')![0];
    act(() => project.updatePanel(pid, { device: 'd9' }));
    expect(screen.getByText(/reads from a device that is not in this workspace/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Use the selected device/ }));
    expect(project.getState().project.panels[pid]!.device).toBeUndefined();
  });
});

describe('workspaces', () => {
  it('show a saved name and can be renamed, and the change is saved', () => {
    const { storage } = mount();
    fireEvent.click(screen.getByRole('button', { name: /My workspace/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename workspace…' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename workspace' });
    fireEvent.change(within(dialog).getByLabelText('Workspace name'), { target: { value: 'Engine test cell' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: /Engine test cell/ })).toBeVisible();
    expect(storage.data['bw.projects']).toContain('Engine test cell');
  });

  it('can be started, listed and opened again', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /My workspace/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New workspace…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New workspace' })).getByRole('button', { name: 'Create' }));
    expect(tabs()).toEqual(['Canvas 1', '+']);
    fireEvent.click(screen.getByRole('button', { name: /Untitled workspace/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open workspace…' }));
    const dialog = screen.getByRole('dialog', { name: 'Open workspace' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^My workspace/ }));
    expect(tabs()).toEqual(['Capture', 'Diagnostics', 'Device', '+']);
  });

  it('export shows the file, and import takes it back or explains why not', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /My workspace/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export or import…' }));
    const dialog = screen.getByRole('dialog', { name: 'Export or import' });
    const exported = (within(dialog).getByLabelText('Workspace file contents') as HTMLTextAreaElement).value;
    expect(JSON.parse(exported).canvases).toHaveLength(3);
    const paste = within(dialog).getByLabelText('Paste a workspace file');
    fireEvent.change(paste, { target: { value: 'nope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('not a workspace file');
    fireEvent.change(paste, { target: { value: exported } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(screen.queryByRole('dialog', { name: 'Export or import' })).toBeNull();
  });

  it('are not written just by opening the page', () => {
    const { storage } = mount();
    expect(Object.keys(storage.data)).toEqual([]);
  });
});

describe('command palette', () => {
  it('opens with Ctrl K, filters, and goes to a canvas', () => {
    mount();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const box = screen.getByRole('combobox', { name: 'Search commands' });
    fireEvent.change(box, { target: { value: 'diag' } });
    expect(screen.getByRole('option', { name: /Go to canvas: Diagnostics/ })).toBeVisible();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Diagnostics' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('dialog', { name: 'Commands' })).toBeNull();
  });

  it('closes with Escape and says when nothing matches', () => {
    mount();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox', { name: 'Search commands' }), { target: { value: 'zzzzzz' } });
    expect(screen.getByText('No command matches.')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Commands' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Commands' })).toBeNull();
  });
});
