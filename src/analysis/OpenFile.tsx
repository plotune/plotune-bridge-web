import { useState } from 'react';
import { ChannelDatabases } from '../components/DatabaseMenu';
import { useDbcRegistry } from '../dbc/context';
import { LogError, logFormatOf, readLog, type CanLog } from '../logs/read';
import { logSource, presentMessages } from '../logs/decode';
import { Modal, useToast } from '../workspace/ui';
import { newId } from '../workspace/layout';
import { CsvError, MAX_CSV_BYTES, recordingFromCsv } from './csv';
import type { Recording } from './math';
import type { RecordingStore } from './context';

export type FileFlow =
  | { kind: 'log'; name: string; log: CanLog; id: string }
  | { kind: 'settings'; recordingId: string }
  | { kind: 'error'; message: string };

/**
 * Opens a file for analysis. A CSV opens at once. A log of CAN frames (ASC, BLF, candump) first asks, in a dialog, which database
 * each of its channels uses: a log is a source of data like a device, and its channels are configured the same way.
 */
export async function startFile(file: File, store: RecordingStore, open: (r: Recording) => void, setFlow: (f: FileFlow | null) => void): Promise<string | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const kind = logFormatOf(file.name, head);
    if (kind === 'parquet') return 'Parquet files are not supported yet. Open a CSV, ASC, BLF or candump log.';
    if (kind === 'csv' || kind === null) {
      if (file.size > MAX_CSV_BYTES) return 'That file is too large to open here.';
      const r = recordingFromCsv(await file.text(), file.name.replace(/\.[^.]+$/, '') || 'Imported recording');
      store.add(r);
      open(r);
      return null;
    }
    const log = await readLog(file);
    setFlow({ kind: 'log', name: file.name.replace(/\.[^.]+$/, '') || 'Log', log, id: newId('r') });
    return null;
  } catch (e) {
    return e instanceof CsvError || e instanceof LogError ? e.message : 'That file could not be read.';
  }
}

function ChannelsOfLog({ id, log }: { id: string; log: CanLog }) {
  return (
    <>
      <p className="bw-fine">{log.frames.count.toLocaleString()} frames · {log.channels.size} {log.channels.size === 1 ? 'channel' : 'channels'} · {log.duration.toFixed(1)} s. Link a database to each channel that should be decoded; channels without one stay raw.</p>
      <ChannelDatabases source={logSource(id)} channels={[...log.channels.keys()]} detail={(ch) => `${(log.channels.get(ch) ?? 0).toLocaleString()} frames`} />
    </>
  );
}

export function OpenFileFlow({ flow, store, open, onClose }: { flow: FileFlow; store: RecordingStore; open: (r: Recording, keys?: readonly string[]) => void; onClose: () => void }) {
  const registry = useDbcRegistry();
  const toast = useToast();
  const [busy] = useState(false);
  if (flow.kind === 'error') {
    return <Modal title="That file could not be opened" onClose={onClose} footer={<button type="button" className="bw-button bw-primary" onClick={onClose}>Close</button>}><p role="alert">{flow.message}</p></Modal>;
  }
  if (flow.kind === 'settings') {
    const entry = store.logs.get(flow.recordingId);
    const rec = store.get(flow.recordingId);
    if (!entry || !rec) return null;
    return (
      <Modal title={`${rec.name} settings`} onClose={onClose} wide footer={<button type="button" className="bw-button bw-primary" onClick={onClose}>Done</button>}>
        <ChannelsOfLog id={flow.recordingId} log={entry.log} />
        <p className="bw-fine">Signals already on a plot keep the values decoded with the previous database. Remove them and add them again to decode with a new one.</p>
      </Modal>
    );
  }
  const cancel = () => { registry.removeSource(logSource(flow.id)); onClose(); };
  const confirm = () => {
    const { log } = flow;
    const rec: Recording = { id: flow.id, name: flow.name.slice(0, 48), created: Date.now(), source: 'log', duration: log.duration, signals: {}, events: [], log: { format: log.format, frames: log.frames.count, channels: [...log.channels] } };
    store.logs.set(rec.id, { log, present: presentMessages(log) });
    store.add(rec);
    open(rec, []);
    toast.show(`Opened “${rec.name}”. Choose its signals with + in the Analyzer.`);
    onClose();
  };
  return (
    <Modal title={`Open ${flow.name}`} onClose={cancel} wide footer={<><button type="button" className="bw-button" onClick={cancel}>Cancel</button><button type="button" className="bw-button bw-primary" onClick={confirm} disabled={busy}>Open in Analyzer</button></>}>
      <ChannelsOfLog id={flow.id} log={flow.log} />
    </Modal>
  );
}
