import { useRef, useState } from 'react';
import { useProject, useProjectStore } from './context';
import { IconMore } from '../components/icons';
import { Modal, NameDialog, useContextMenu, useToast } from './ui';

const ago = (t: number): string => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function OpenProjects({ onClose }: { onClose: () => void }) {
  const store = useProjectStore();
  const { project, projects } = useProject();
  const toast = useToast();
  return (
    <Modal title="Open workspace" onClose={onClose}>
      <ul className="bw-project-list">
        {projects.map((p) => (
          <li key={p.id}>
            <button type="button" className="bw-project-open" aria-current={p.id === project.id ? 'true' : undefined} onClick={() => { store.openProject(p.id); onClose(); }}>
              <strong>{p.name}{p.id === project.id ? ' (open)' : ''}</strong>
              <small>{p.canvases.length} {p.canvases.length === 1 ? 'canvas' : 'canvases'}: {p.canvases.join(', ')}</small>
              <small>Saved {ago(p.updated)} in this browser</small>
            </button>
            {p.id !== project.id && (
              <button type="button" className="bw-button bw-small bw-danger" aria-label={`Delete ${p.name}`} onClick={() => { store.deleteProject(p.id); toast.show(`Deleted “${p.name}”`); }}>Delete</button>
            )}
          </li>
        ))}
      </ul>
      <p className="bw-fine">Workspaces are saved in this browser. Saving them in your Plotune project, to open on another device, is planned.</p>
    </Modal>
  );
}

function ExportImport({ onClose }: { onClose: () => void }) {
  const store = useProjectStore();
  const toast = useToast();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const json = store.exportJson();
  const doImport = (raw: string) => {
    const r = store.importJson(raw);
    if (r.ok) { toast.show(`Imported “${r.name}”`); onClose(); } else setError(r.reason);
  };
  return (
    <Modal title="Export or import" onClose={onClose} wide footer={<button type="button" className="bw-button" onClick={onClose}>Close</button>}>
      <h3>Export this workspace</h3>
      <textarea className="bw-json" readOnly rows={6} aria-label="Workspace file contents" value={json} />
      <div className="bw-actions">
        <button type="button" className="bw-button" onClick={() => { void navigator.clipboard?.writeText(json).then(() => toast.show('Copied'), () => toast.show('Select the text and copy it')); }}>Copy</button>
        <a className="bw-button" href={`data:application/json;charset=utf-8,${encodeURIComponent(json)}`} download={`${store.getState().project.name.replace(/[^\w.-]+/g, '-')}.bridge-workspace.json`}>Download</a>
      </div>
      <h3>Import a workspace</h3>
      <textarea className="bw-json" rows={5} aria-label="Paste a workspace file" placeholder="Paste a workspace file here" value={text} onChange={(e) => { setText(e.target.value); setError(''); }} />
      {error && <p className="bw-error" role="alert">{error}</p>}
      <div className="bw-actions">
        <button type="button" className="bw-button bw-primary" disabled={!text.trim()} onClick={() => doImport(text)}>Import</button>
        <button type="button" className="bw-button" onClick={() => file.current?.click()}>Choose a file…</button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(doImport); e.target.value = ''; }} />
      </div>
    </Modal>
  );
}

/** The project name in the top bar. Everything about the whole project lives behind it. */
export function ProjectMenu() {
  const store = useProjectStore();
  const { project, saveFailed } = useProject() as ReturnType<typeof useProject> & { saveFailed: boolean };
  const menu = useContextMenu('Workspace');
  const [dialog, setDialog] = useState<'rename' | 'open' | 'export' | 'new' | 'copy' | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="bw-icon-button bw-project-button"
        aria-haspopup="menu"
        aria-label={`${project.name}, workspace menu`}
        title={`${project.name} · ${saveFailed ? 'not saved' : 'saved in this browser'}`}
        onClick={() => { const r = button.current!.getBoundingClientRect(); menu.open(r.left, r.bottom + 4, [
          { heading: saveFailed ? 'Could not save in this browser' : 'Saved in this browser' },
          { label: 'Rename workspace…', onSelect: () => setDialog('rename') },
          { label: 'New workspace…', onSelect: () => setDialog('new') },
          { label: 'Open workspace…', onSelect: () => setDialog('open') },
          { label: 'Duplicate workspace…', onSelect: () => setDialog('copy') },
          { separator: true },
          { label: 'Export or import…', onSelect: () => setDialog('export') },
        ]); }}
      >
        <IconMore />
        <span className={`bw-project-state ${saveFailed ? 'is-bad' : ''}`} aria-hidden="true" />
      </button>
      {menu.menu}
      {dialog === 'rename' && <NameDialog title="Rename workspace" label="Workspace name" initial={project.name} onSubmit={(v) => store.renameProject(v)} onClose={() => setDialog(null)} />}
      {dialog === 'new' && <NameDialog title="New workspace" label="Workspace name" initial="Untitled workspace" action="Create" onSubmit={(v) => store.newProject(v)} onClose={() => setDialog(null)} />}
      {dialog === 'copy' && <NameDialog title="Duplicate workspace" label="Name of the copy" initial={`${project.name} copy`} action="Duplicate" onSubmit={(v) => store.duplicateProject(v)} onClose={() => setDialog(null)} />}
      {dialog === 'open' && <OpenProjects onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportImport onClose={() => setDialog(null)} />}
    </>
  );
}
