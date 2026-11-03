import { useRef, useState } from 'react';
import { IconAnalyze, IconEdit, IconSettings, IconTrash, IconUpload } from '../components/icons';
import { Panel } from '../components/Panel';
import { NameDialog, useToast } from '../workspace/ui';
import { useAnalysis, useRecordings } from './context';

const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function RecordingsPanel() {
  const { store, open, openFile, logSettings } = useAnalysis();
  const recordings = useRecordings();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState('');
  const choose = async (f: File) => {
    const message = await openFile(f);
    setError(message ?? '');
  };
  const renamingRec = recordings.find((r) => r.id === renaming);
  return (
    <Panel
      id="recordings"
      title="Recordings"
      status={`${recordings.length} ${recordings.length === 1 ? 'recording' : 'recordings'}`}
      actions={<><button type="button" className="bw-icon-button" aria-label="Open a file…" title="Open a file to analyse (CSV, ASC, BLF, candump)" onClick={() => file.current?.click()}><IconUpload /></button><input ref={file} type="file" accept=".csv,.asc,.blf,.log,.txt,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void choose(f); }} /></>}
    >
      {error && <p className="bw-error" role="alert">{error}</p>}
      {recordings.length === 0 ? (
        <div className="bw-empty-block">
          <p><strong>No recordings yet</strong></p>
          <p className="bw-fine">Open a file with the upload icon: a CAN log (ASC, BLF or candump), where you link a database to each channel, or a CSV (the Scope’s own export, or a time column followed by one column per signal). In the Scope, “Analyze this window” keeps what is on screen and opens it here.</p>
        </div>
      ) : (
        <ul className="bw-recordings">
          {recordings.map((r) => (
            <li key={r.id}>
              <div>
                <strong>{r.name}</strong>
                <small>{r.duration.toFixed(1)} s · {r.log ? `${r.log.frames.toLocaleString()} frames · ${r.log.channels.length} ${r.log.channels.length === 1 ? 'channel' : 'channels'}` : `${Object.keys(r.signals).length} signals`} · {r.source === 'scope' ? 'from the Scope' : r.source === 'log' ? r.log?.format.toUpperCase() : 'imported'} · {when(r.created)}</small>
              </div>
              <div className="bw-actions">
                {r.log && <button type="button" className="bw-icon-button" onClick={() => logSettings(r.id)} aria-label={`Settings for ${r.name}`} title="Channels and databases of this log"><IconSettings /></button>}
                <button type="button" className="bw-icon-button" onClick={() => open(r)} aria-label="Analyze" title="Open in an Analyzer"><IconAnalyze /></button>
                <button type="button" className="bw-icon-button" onClick={() => setRenaming(r.id)} aria-label={`Rename ${r.name}`} title="Rename"><IconEdit /></button>
                <button type="button" className="bw-icon-button" onClick={() => { const prev = r; store.remove(r.id); toast.show(`Removed “${prev.name}”`, { label: 'Undo', run: () => store.add(prev) }); }} aria-label={`Remove ${r.name}`} title="Remove"><IconTrash /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="bw-fine">Recordings stay in this page until you close it. Keep one by copying its CSV from the Analyzer.</p>
      {renamingRec && <NameDialog title="Rename recording" label="Recording name" initial={renamingRec.name} onSubmit={(v) => store.rename(renamingRec.id, v)} onClose={() => setRenaming(null)} />}
    </Panel>
  );
}
