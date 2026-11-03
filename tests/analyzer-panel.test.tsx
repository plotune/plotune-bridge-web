// The Analyzer's list and dialogs, without a canvas (jsdom has none): values at cursors, statistics, calculated signals, missing recordings.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AnalyzerPanel } from '../src/analysis/AnalyzerPanel';
import { AnalysisProvider, RecordingStore } from '../src/analysis/context';
import { recordingFromCsv } from '../src/analysis/csv';
import { addSignals, emptyConfig } from '../src/analysis/model';
import { RecordingsPanel } from '../src/analysis/RecordingsPanel';
import { ProjectProvider } from '../src/workspace/context';
import { ProjectStore, type StoragePort } from '../src/workspace/project';
import { ToastProvider } from '../src/workspace/ui';

afterEach(cleanup);
const mem = (): StoragePort => { const d: Record<string, string> = {}; return { getItem: (k) => d[k] ?? null, setItem: (k, v) => { d[k] = v; }, removeItem: (k) => { delete d[k]; } }; };
const CSV = 'time_s,Speed [km/h],Torque [Nm]\n' + Array.from({ length: 11 }, (_, i) => `${i},${i * 10},${100 - i * 5}`).join('\n') + '\n';

function setup(withSignals = true) {
  const project = new ProjectStore(() => mem());
  const recs = new RecordingStore();
  const rec = recordingFromCsv(CSV, 'Run');
  recs.add(rec);
  const pid = project.addPanel('analyzer')!;
  if (withSignals) project.setPanelConfig(pid, addSignals(emptyConfig(rec.id), rec, Object.keys(rec.signals), 'new', 'individual') as unknown as Record<string, unknown>);
  else project.setPanelConfig(pid, { file: rec.id });
  render(
    <ProjectProvider store={project}>
      <ToastProvider>
        <AnalysisProvider store={recs}>
          <AnalyzerPanel pid={pid} />
        </AnalysisProvider>
      </ToastProvider>
    </ProjectProvider>,
  );
  return { project, recs, rec, pid };
}

describe('Analyzer', () => {
  it('lists its signals with units', () => {
    setup();
    const table = screen.getByRole('table', { name: /Signals on the plot/ });
    expect(within(table).getByRole('rowheader', { name: 'Speed' })).toBeVisible();
    expect(within(table).getByRole('rowheader', { name: 'Torque' })).toBeVisible();
    expect(screen.getByText('10.0 s · 2 signals')).toBeVisible();
  });

  it('shows values at cursor A and B and their difference', () => {
    setup();
    const row = () => screen.getByRole('rowheader', { name: 'Speed' }).closest('tr')!;
    expect(within(row()).queryAllByRole('cell').map((c) => c.textContent).join('|')).not.toMatch(/\d\d\.\d\d/);
    fireEvent.click(screen.getByRole('button', { name: 'Cursors' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cursors' }));
    // The cursors start a quarter of the way in from each side of the view: at 2.5 s and 7.5 s.
    const cells = within(row()).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toContain('25.00');
    expect(cells).toContain('75.00');
    expect(cells).toContain('+50.00');
    // A third click removes both.
    fireEvent.click(screen.getByRole('button', { name: 'Cursors' }));
    expect(within(row()).getAllByRole('cell').map((c) => c.textContent)).not.toContain('25.00');
  });

  it('shows statistics of the visible range, and of the cursor range once there are cursors', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Statistics' }));
    expect(screen.getByRole('columnheader', { name: 'Avg' })).toBeVisible();
    const row = screen.getByRole('rowheader', { name: 'Speed' }).closest('tr')!;
    // 0, 10 … 100: min 0, max 100, average 50.
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(expect.arrayContaining(['0.00', '100.00', '50.00']));
    expect(screen.getByText(/visible range 0.0 to 10.0 s/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cursors' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cursors' }));
    expect(screen.getByText(/cursor range 2.50 to 7.50 s/)).toBeVisible();
  });

  it('hides and shows a curve from the list', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Speed' }));
    expect(screen.getByRole('button', { name: 'Show Speed' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('adds a calculated signal from a formula, and explains a bad one', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Calculated' }));
    const dialog = screen.getByRole('dialog', { name: 'Calculated signal' });
    fireEvent.change(within(dialog).getByLabelText('Formula'), { target: { value: 'Speed * Torque' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Power' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to plot' }));
    expect(screen.getByRole('rowheader', { name: 'Power' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Calculated' }));
    const again = screen.getByRole('dialog', { name: 'Calculated signal' });
    fireEvent.change(within(again).getByLabelText('Formula'), { target: { value: 'Speed + Nope' } });
    fireEvent.click(within(again).getByRole('button', { name: 'Add to plot' }));
    expect(within(again).getByRole('alert')).toHaveTextContent('There is no signal called “Nope”');
  });

  it('adds a signal from the Signal menu and removes one from the list menu', () => {
    const { project, pid } = setup(false);
    expect(screen.getByText(/No signals yet/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Signal' }));
    const dialog = screen.getByRole('dialog', { name: 'Add signals' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Speed/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add 1 signal/ }));
    expect(screen.getByRole('rowheader', { name: 'Speed' })).toBeVisible();
    fireEvent.contextMenu(screen.getByRole('rowheader', { name: 'Speed' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(screen.queryByRole('rowheader', { name: 'Speed' })).toBeNull();
    expect(pid).toBeTruthy();
    expect(project.getState().project.panels[pid]).toBeTruthy();
  });

  it('saves its settings with the workspace', async () => {
    const { project, pid } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Statistics' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 650)); });
    expect((project.getState().project.panels[pid]!.config as { stats: boolean }).stats).toBe(true);
  });

  it('keeps its settings and says so when the recording is not in this page', () => {
    const project = new ProjectStore(() => mem());
    const pid = project.addPanel('analyzer')!;
    project.setPanelConfig(pid, { file: 'gone', strips: [], sigs: [], axes: {}, calcs: [], cur: { active: 'a' }, sample: false, stats: false });
    render(
      <ProjectProvider store={project}><ToastProvider><AnalysisProvider store={new RecordingStore()}><AnalyzerPanel pid={pid} /></AnalysisProvider></ToastProvider></ProjectProvider>,
    );
    expect(screen.getByText('This recording is not available here.')).toBeVisible();
    expect((project.getState().project.panels[pid]!.config as { file: string }).file).toBe('gone');
  });
});

describe('Recordings', () => {
  it('imports a CSV and opens it in an Analyzer', async () => {
    const project = new ProjectStore(() => mem());
    const recs = new RecordingStore();
    render(
      <ProjectProvider store={project}><ToastProvider><AnalysisProvider store={recs}><RecordingsPanel /></AnalysisProvider></ToastProvider></ProjectProvider>,
    );
    expect(screen.getByText('No recordings yet')).toBeVisible();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File([CSV], 'drive.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => CSV });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); await Promise.resolve(); await Promise.resolve(); });
    expect(await screen.findByText('drive')).toBeVisible();
    const st = project.getState().project;
    const types = Object.values(st.panels).map((p) => p.type);
    expect(types).toContain('analyzer');
  });

  it('refuses a file that is not a recording, in plain words', async () => {
    const recs = new RecordingStore();
    render(
      <ProjectProvider store={new ProjectStore(() => mem())}><ToastProvider><AnalysisProvider store={recs}><RecordingsPanel /></AnalysisProvider></ToastProvider></ProjectProvider>,
    );
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['hello'], 'x.csv');
    Object.defineProperty(file, 'text', { value: async () => 'hello' });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); await Promise.resolve(); await Promise.resolve(); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not look like a CSV/);
    expect(recs.getSnapshot()).toHaveLength(0);
  });

  it('renames and removes a recording, and can undo the removal', async () => {
    const recs = new RecordingStore();
    const r = recordingFromCsv(CSV, 'Run');
    recs.add(r);
    render(
      <ProjectProvider store={new ProjectStore(() => mem())}><ToastProvider><AnalysisProvider store={recs}><RecordingsPanel /></AnalysisProvider></ToastProvider></ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename Run' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename recording' });
    fireEvent.change(within(dialog).getByLabelText('Recording name'), { target: { value: 'Night run' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Night run')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Night run' }));
    expect(recs.getSnapshot()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(recs.getSnapshot()).toHaveLength(1);
  });
});
