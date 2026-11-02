import { useRef, useState } from 'react';
import { Panel } from '../components/Panel';
import { NameDialog, useToast } from '../workspace/ui';
import { useAnalysis, useRecordings } from './context';
import { CsvError, MAX_CSV_BYTES, recordingFromCsv } from './csv';

const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function RecordingsPanel() {
  const { store, open } = useAnalysis();
  const recordings = useRecordings();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState('');
  const importText = (text: string, name: string) => {
    try {
      const r = recordingFromCsv(text, name.replace(/\.[^.]+$/, '') || 'Imported recording');
      store.add(r);
      setError('');
      open(r);
      toast.show(`Opened “${r.name}” in the Analyzer`);
    } catch (e) { setError(e instanceof CsvError ? e.message : 'That file could not be read.'); }
  };
  const renamingRec = recordings.find((r) => r.id === renaming);
  return (
    <Panel
      id="recordings"
      title="Recordings"
      status={`${recordings.length} ${recordings.length === 1 ? 'recording' : 'recordings'}`}
      actions={<><button type="button" className="bw-button bw-small" onClick={() => file.current?.click()}>Import CSV…</button><input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; if (f.size > MAX_CSV_BYTES) { setError('That file is too large to open here.'); return; } void f.text().then((t) => importText(t, f.name)); }} /></>}
    >
      {error && <p className="bw-error" role="alert">{error}</p>}
      {recordings.length === 0 ? (
        <div className="bw-empty-block">
          <p><strong>No recordings yet</strong></p>
          <p className="bw-fine">In the Scope, choose “Analyze this window” to keep what is on screen and study it here. You can also import a CSV file: the Scope’s own export, or a time column followed by one column per signal.</p>
        </div>
      ) : (
        <ul className="bw-recordings">
          {recordings.map((r) => (
            <li key={r.id}>
              <div>
                <strong>{r.name}</strong>
                <small>{r.duration.toFixed(1)} s · {Object.keys(r.signals).length} signals · {r.source === 'scope' ? 'from the Scope' : 'imported'} · {when(r.created)}</small>
              </div>
              <div className="bw-actions">
                <button type="button" className="bw-button bw-small bw-primary" onClick={() => open(r)}>Analyze</button>
                <button type="button" className="bw-button bw-small" onClick={() => setRenaming(r.id)} aria-label={`Rename ${r.name}`}>Rename</button>
                <button type="button" className="bw-button bw-small" onClick={() => { const prev = r; store.remove(r.id); toast.show(`Removed “${prev.name}”`, { label: 'Undo', run: () => store.add(prev) }); }} aria-label={`Remove ${r.name}`}>Remove</button>
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
