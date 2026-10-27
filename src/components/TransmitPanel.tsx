import { useState, type FormEvent } from 'react';
import { bytesToHex, formatId } from '../lib/bytes';
import { validateTx, type TxForm } from '../lib/txForm';
import { useStore, useWorkspace } from '../state/context';
import { IconAlert, IconCheck, IconSend } from './icons';
import { Panel } from './Panel';

export function TransmitPanel() {
  const store = useStore();
  const state = useWorkspace();
  const [form, setForm] = useState<TxForm>({ channel: 1, id: '123', extended: false, rtr: false, dlc: '0', data: '11 22 33 44' });
  const [touched, setTouched] = useState(false);
  const { frame, errors } = validateTx(form);
  const set = (patch: Partial<TxForm>) => setForm((f) => ({ ...f, ...patch }));
  const channel = state.channels.find((c) => c.channel === form.channel);
  const unconfigured = channel?.bitrate === null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (frame) void store.transmit(frame);
  };

  return (
    <Panel id="transmit" title="Send frame">
      <form className="bw-form bw-tx" onSubmit={submit} noValidate>
        <div className="bw-tx-grid">
          <label className="bw-field">
            <span>Channel</span>
            <select value={form.channel} onChange={(e) => set({ channel: Number(e.target.value) })}>
              {state.channels.map((c) => (
                <option key={c.channel} value={c.channel}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="bw-field">
            <span>ID (hex)</span>
            <input value={form.id} onChange={(e) => set({ id: e.target.value })} className="bw-mono" aria-invalid={touched && !!errors.id} aria-describedby="tx-id-error" spellCheck={false} autoComplete="off" />
            {touched && errors.id && <small id="tx-id-error" className="bw-error-text">{errors.id}</small>}
          </label>
          <label className="bw-field">
            <span>ID format</span>
            <select value={form.extended ? 'ext' : 'std'} onChange={(e) => set({ extended: e.target.value === 'ext' })}>
              <option value="std">Standard (11-bit)</option>
              <option value="ext">Extended (29-bit)</option>
            </select>
          </label>
          <label className="bw-field">
            <span>Frame type</span>
            <select value={form.rtr ? 'rtr' : 'data'} onChange={(e) => set({ rtr: e.target.value === 'rtr' })}>
              <option value="data">Data</option>
              <option value="rtr">Remote request</option>
            </select>
          </label>
        </div>
        {form.rtr ? (
          <label className="bw-field">
            <span>Requested length (0 to 8)</span>
            <input value={form.dlc} onChange={(e) => set({ dlc: e.target.value })} className="bw-mono bw-narrow" inputMode="numeric" aria-invalid={touched && !!errors.dlc} />
            {touched && errors.dlc && <small className="bw-error-text">{errors.dlc}</small>}
          </label>
        ) : (
          <label className="bw-field">
            <span>Data (hex bytes)</span>
            <input value={form.data} onChange={(e) => set({ data: e.target.value })} className="bw-mono" aria-invalid={touched && !!errors.data} aria-describedby="tx-data-error" spellCheck={false} autoComplete="off" />
            {touched && errors.data ? <small id="tx-data-error" className="bw-error-text">{errors.data}</small> : <small>{frame ? `${frame.dlc} ${frame.dlc === 1 ? 'byte' : 'bytes'}` : ''}</small>}
          </label>
        )}
        {unconfigured && <p className="bw-hint">Set a bit rate on {channel?.name} before sending.</p>}
        <div className="bw-actions">
          <button type="submit" className="bw-button bw-primary" disabled={unconfigured}>
            <IconSend /> Send
          </button>
        </div>
      </form>
      <ul className="bw-txlog" aria-label="Recent sends" data-testid="tx-log">
        {state.txLog.map((entry) => (
          <li key={entry.id} className={entry.ok ? 'is-ok' : 'is-error'}>
            {entry.ok ? <IconCheck /> : <IconAlert />}
            <span className="bw-mono">
              CAN{entry.frame.channel} · {formatId(entry.frame.id, entry.frame.extended)} · {entry.frame.rtr ? `remote ${entry.frame.dlc}` : bytesToHex(entry.frame.data, ' ').toUpperCase() || 'no data'}
            </span>
            <span className="bw-muted">{entry.message}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
