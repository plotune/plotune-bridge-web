import { useRef, useState } from 'react';
import { useDbcAssignments, useDbcRegistry } from '../dbc/context';
import { readDbcFile } from '../dbc/readFile';
import { IconClose, IconCopy, IconUpload } from './icons';

/** One channel's database: load, see the file name, reuse another channel's file, remove. Read in the browser, never uploaded. */
function ChannelDatabase({ source, channel, detail }: { source: string; channel: number; detail?: string }) {
  const registry = useDbcRegistry();
  const assigned = useDbcAssignments().find((a) => a.source === source && a.channel === channel);
  const available = useDbcAssignments().filter((a) => a.source === source && a.channel !== channel);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const name = `CAN${channel}`;
  async function onFile(file: File | undefined) {
    if (!file) return;
    const read = await readDbcFile(file);
    const result = read.ok ? registry.assign(source, channel, file.name, read.text) : read;
    if (result.ok) {
      setError(null);
      setNotes(result.warnings);
    } else {
      setError(result.message);
      setNotes([]);
    }
  }
  return (
    <div className="bw-db-row" data-testid={`db-row-${channel}`}>
      <strong>{name}{detail ? <small className="bw-muted"> {detail}</small> : null}</strong>
      {assigned ? (
        <>
          <span className="bw-db-name" title={assigned.fileName}>{assigned.fileName}</span>
          <small>{assigned.dbc.messages.length} {assigned.dbc.messages.length === 1 ? 'message' : 'messages'} · {assigned.dbc.messages.reduce((n, m) => n + m.signals.length, 0).toLocaleString()} signals</small>
          <button type="button" className="bw-icon-button" aria-label={`Remove the database from ${name}`} title="Remove the database" onClick={() => { registry.remove(source, channel); setNotes([]); setError(null); }}>
            <IconClose />
          </button>
        </>
      ) : (
        <>
          <span className="bw-muted bw-db-name">No database: frames show raw data</span>
          {available.length > 0 && (
            <button type="button" className="bw-icon-button" aria-label={`Use the database of CAN${available[0]!.channel} for ${name}`} title={`Use the same file as CAN${available[0]!.channel}`} onClick={() => registry.copy({ source, channel: available[0]!.channel }, { source, channel })}>
              <IconCopy />
            </button>
          )}
          <button type="button" className="bw-icon-button" aria-label={`Load a database (DBC) for ${name}`} title="Load a DBC file" onClick={() => input.current?.click()}>
            <IconUpload />
          </button>
        </>
      )}
      <input ref={input} type="file" accept=".dbc,text/plain" hidden aria-hidden="true" tabIndex={-1} data-testid={`dbc-input-${channel}`} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <p className="bw-inline-error bw-db-wide" role="alert">{error}</p>}
      {notes.length > 0 && (
        <details className="bw-details bw-db-wide">
          <summary>{notes.length} {notes.length === 1 ? 'note' : 'notes'} about this file</summary>
          <ul>{notes.slice(0, 20).map((note) => <li key={note}>{note}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/**
 * The databases (DBC) of one source: a device or a log file. Each channel has its own, so two identical devices, or a log with seven
 * channels, are told apart by whose channel it is. The database names the messages and signals in the Trace, the Scope and the Analyzer.
 */
export function ChannelDatabases({ source, channels, detail }: { source: string; channels: number[]; detail?: (channel: number) => string }) {
  return (
    <div className="bw-db-list" role="group" aria-label={`Databases of ${source}`}>
      <p className="bw-fine">A database (DBC) names the messages and signals of a channel. The file stays in this browser.</p>
      {channels.map((channel) => (
        <ChannelDatabase key={channel} source={source} channel={channel} detail={detail?.(channel)} />
      ))}
    </div>
  );
}
