import { useRef, useState } from 'react';
import { useDbcAssignments, useDbcRegistry } from '../dbc/context';
import { readDbcFile } from '../dbc/readFile';
import { useHubState } from '../state/context';
import { IconPanels } from './icons';

/** One channel's database: load, see the file name, remove. Read in the browser, never uploaded. */
function DatabaseRow({ channel }: { channel: number }) {
  const registry = useDbcRegistry();
  const assigned = useDbcAssignments().find((a) => a.channel === channel);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const name = `CAN${channel}`;
  async function onFile(file: File | undefined) {
    if (!file) return;
    const read = await readDbcFile(file);
    const result = read.ok ? registry.assign(channel, file.name, read.text) : read;
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
      <strong>{name}</strong>
      {assigned ? (
        <>
          <span className="bw-db-name" title={assigned.fileName}>{assigned.fileName}</span>
          <small>{assigned.dbc.messages.length} {assigned.dbc.messages.length === 1 ? 'message' : 'messages'}</small>
          <button type="button" className="bw-button bw-small" aria-label={`Remove the database from ${name}`} onClick={() => { registry.remove(channel); setNotes([]); setError(null); }}>
            Remove
          </button>
        </>
      ) : (
        <button type="button" className="bw-button bw-small" aria-label={`Load a database (DBC) for ${name}`} onClick={() => input.current?.click()}>
          Load DBC…
        </button>
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

/** A database (DBC) per channel names the messages and signals in the Trace. It lives in the toolbar so it is easy to find. */
export function DatabaseMenu() {
  const { slots } = useHubState();
  const assigned = useDbcAssignments();
  const fromDevices = slots.flatMap((s) => s.store.getState().channels.map((c) => c.channel));
  const channels = [...new Set([1, 2, ...fromDevices, ...assigned.map((a) => a.channel)])].sort((a, b) => a - b);
  return (
    <details className="bw-menu">
      <summary className="bw-button bw-small">
        <IconPanels /> Databases{assigned.length > 0 ? ` · ${assigned.length}` : ''}
      </summary>
      <div className="bw-menu-body bw-db-menu" role="group" aria-label="Databases per channel">
        <p className="bw-fine">A DBC names messages and signals in the Trace. The file stays in this browser.</p>
        {channels.map((channel) => (
          <DatabaseRow key={channel} channel={channel} />
        ))}
      </div>
    </details>
  );
}
