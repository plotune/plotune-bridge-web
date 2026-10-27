import { useState, type FormEvent, type ReactNode } from 'react';
import { IsoTpError } from '../diagnostics/isotp';
import type { DiagSettings } from '../diagnostics/settings';
import { buildKeySend, buildReadDid, buildSeedRequest, buildSessionControl, buildTesterPresent, describePositive, serviceName, type UdsClient, type UdsResult } from '../diagnostics/uds';
import { XcpError, type XcpClient } from '../diagnostics/xcp';
import { bytesToHex, memoryDump, parseHexBytes, parseHexNumber } from '../lib/bytes';
import { useWorkspace } from '../state/context';
import { DiagLog, NeedsCapture, logEntry, type LogEntry } from './diagnostics';
import { IconSend } from './icons';
import { Panel } from './Panel';

const hex = (b: Uint8Array) => bytesToHex(b, ' ').toUpperCase();

export function LinkPanel({ settings, onChange, errors }: { settings: DiagSettings; onChange: (patch: Partial<DiagSettings>) => void; errors: string[] }) {
  const state = useWorkspace();
  const text = (key: keyof DiagSettings, label: string, hint?: string) => (
    <label className="bw-field">
      <span>{label}</span>
      <input className="bw-mono bw-narrow" value={String(settings[key])} onChange={(e) => onChange({ [key]: e.target.value } as Partial<DiagSettings>)} spellCheck={false} autoComplete="off" />
      {hint && <small>{hint}</small>}
    </label>
  );
  return (
    <Panel id="link" title="Diagnostic link" status={errors.length ? 'Check settings' : 'Ready'}>
      <div className="bw-diag-settings">
        <label className="bw-field">
          <span>Channel</span>
          <select value={settings.channel} onChange={(e) => onChange({ channel: Number(e.target.value) })}>
            {state.channels.map((c) => (
              <option key={c.channel} value={c.channel}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="bw-field">
          <span>ID format</span>
          <select value={settings.extended ? 'ext' : 'std'} onChange={(e) => onChange({ extended: e.target.value === 'ext' })}>
            <option value="std">Standard (11-bit)</option>
            <option value="ext">Extended (29-bit)</option>
          </select>
        </label>
        {text('udsRequestId', 'Request ID (hex)', 'Where requests are sent.')}
        {text('udsResponseId', 'Response ID (hex)', 'Where answers arrive.')}
        {text('xcpRequestId', 'Calibration command ID (hex)')}
        {text('xcpResponseId', 'Calibration response ID (hex)')}
        <label className="bw-field">
          <span>Pad frames</span>
          <select value={settings.padding} onChange={(e) => onChange({ padding: e.target.value as DiagSettings['padding'] })}>
            <option value="00">To 8 bytes with 00</option>
            <option value="AA">To 8 bytes with AA</option>
            <option value="none">Do not pad</option>
          </select>
        </label>
        <label className="bw-field">
          <span>Timeout (ms)</span>
          <input className="bw-mono bw-narrow" inputMode="numeric" value={settings.timeoutMs} onChange={(e) => onChange({ timeoutMs: Math.min(10_000, Math.max(50, Number(e.target.value) || 1000)) })} />
        </label>
        <label className="bw-field bw-check-field">
          <span>Pad calibration commands to 8 bytes</span>
          <input type="checkbox" checked={settings.xcpPadTo8} onChange={(e) => onChange({ xcpPadTo8: e.target.checked })} />
        </label>
      </div>
      {errors.map((e) => (
        <p key={e} className="bw-inline-error" role="alert">{e}</p>
      ))}
      <p className="bw-fine">These identifiers are examples. Use the ones your target uses.</p>
    </Panel>
  );
}

function ControlRow({ children }: { children: ReactNode }) {
  return <div className="bw-controlrow">{children}</div>;
}

function summarize(result: UdsResult): Pick<LogEntry, 'tone' | 'title' | 'detail'> {
  if (result.kind === 'negative') {
    return { tone: 'bad', title: `Refused: ${result.name} (0x${result.nrc.toString(16).toUpperCase().padStart(2, '0')}) for ${serviceName(result.service)}`, detail: hex(result.raw) };
  }
  const pending = result.pendingResponses ? ` (after ${result.pendingResponses} "still working" ${result.pendingResponses === 1 ? 'answer' : 'answers'})` : '';
  return { tone: 'good', title: `${describePositive(result) ?? `${serviceName(result.service)}: positive answer`}${pending}`, detail: hex(result.raw) };
}

export function UdsPanel({ uds, settings, log, onLog }: { uds: UdsClient | null; settings: DiagSettings; log: LogEntry[]; onLog: (e: LogEntry) => void }) {
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState('03');
  const [dids, setDids] = useState('F190');
  const [level, setLevel] = useState('01');
  const [key, setKey] = useState('');
  const [raw, setRaw] = useState('22 F1 90');
  const [error, setError] = useState<string | null>(null);

  const send = async (bytes: Uint8Array | null, problem = 'Use pairs of hex digits.') => {
    setError(null);
    if (!uds) return setError('Fix the diagnostic link settings first.');
    if (!bytes || bytes.length === 0) return setError(problem);
    setBusy(true);
    try {
      onLog(logEntry({ request: hex(bytes), ...summarize(await uds.request(bytes)) }));
    } catch (e) {
      onLog(logEntry({ request: hex(bytes), tone: 'bad', title: e instanceof IsoTpError || e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  const didList = () => {
    const parts = dids.split(/[\s,]+/).filter(Boolean);
    const values = parts.map((p) => (/^[0-9a-f]{1,4}$/i.test(p) ? parseInt(p, 16) : NaN));
    return parts.length && values.every((v) => !Number.isNaN(v)) ? values : null;
  };
  const levelNumber = parseHexNumber(level);
  const submitRaw = (e: FormEvent) => {
    e.preventDefault();
    void send(parseHexBytes(raw));
  };
  const disabled = busy || !uds;

  return (
    <Panel id="uds" title="Diagnostic requests" status={`CAN${settings.channel}`}>
      <NeedsCapture channel={settings.channel} />
      <div className="bw-controls">
        <ControlRow>
          <label className="bw-field bw-inline">
            <span>Session</span>
            <select value={session} onChange={(e) => setSession(e.target.value)}>
              <option value="01">Default (01)</option>
              <option value="02">Programming (02)</option>
              <option value="03">Extended (03)</option>
            </select>
          </label>
          <button type="button" className="bw-button" disabled={disabled} onClick={() => void send(buildSessionControl(parseInt(session, 16)))}>Start session</button>
          <button type="button" className="bw-button" disabled={disabled} onClick={() => void send(buildTesterPresent())}>Tester present</button>
        </ControlRow>
        <ControlRow>
          <label className="bw-field bw-inline">
            <span>Data IDs (hex)</span>
            <input className="bw-mono" value={dids} onChange={(e) => setDids(e.target.value)} spellCheck={false} aria-label="Data identifiers" />
          </label>
          <button type="button" className="bw-button" disabled={disabled} onClick={() => { const v = didList(); void send(v ? buildReadDid(v) : null, 'Enter data IDs as hex, for example F190 F191.'); }}>Read data</button>
        </ControlRow>
        <ControlRow>
          <label className="bw-field bw-inline">
            <span>Access level</span>
            <input className="bw-mono bw-narrow" value={level} onChange={(e) => setLevel(e.target.value)} spellCheck={false} aria-label="Security access level" />
          </label>
          <button type="button" className="bw-button" disabled={disabled} onClick={() => void send(levelNumber !== null && levelNumber % 2 === 1 ? buildSeedRequest(levelNumber) : null, 'The level for a seed request is an odd number, for example 01.')}>Request seed</button>
          <label className="bw-field bw-inline">
            <span>Key (hex)</span>
            <input className="bw-mono" value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} aria-label="Security access key" />
          </label>
          <button type="button" className="bw-button" disabled={disabled} onClick={() => { const k = parseHexBytes(key); void send(levelNumber !== null && levelNumber % 2 === 1 && k && k.length ? buildKeySend(levelNumber, k) : null, 'Enter the key you calculated, as hex.'); }}>Send key</button>
        </ControlRow>
        <form onSubmit={submitRaw}>
          <ControlRow>
            <label className="bw-field bw-inline bw-grow">
              <span>Request (hex)</span>
              <input className="bw-mono" value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} aria-label="Raw request" />
            </label>
            <button type="submit" className="bw-button bw-primary" disabled={disabled}><IconSend /> Send request</button>
          </ControlRow>
        </form>
      </div>
      {error && <p className="bw-inline-error" role="alert">{error}</p>}
      <p className="bw-fine">Requests are sent exactly as typed. Plotune does not provide flashing procedures or key calculation: work out a key with your own tools and enter it above.</p>
      <DiagLog entries={log} label="Diagnostic log" />
    </Panel>
  );
}

export function XcpPanel({ xcp, settings, log, onLog }: { xcp: XcpClient | null; settings: DiagSettings; log: LogEntry[]; onLog: (e: LogEntry) => void }) {
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState('0');
  const [length, setLength] = useState('16');
  const [writeAddress, setWriteAddress] = useState('0');
  const [writeData, setWriteData] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, rerender] = useState(0);

  const run = async (request: string, action: () => Promise<{ title: string; detail?: string }>) => {
    setError(null);
    if (!xcp) return setError('Fix the diagnostic link settings first.');
    setBusy(true);
    try {
      const out = await action();
      onLog(logEntry({ request, tone: 'good', ...out }));
    } catch (e) {
      onLog(logEntry({ request, tone: 'bad', title: e instanceof XcpError || e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
      rerender((n) => n + 1);
    }
  };
  const addr = parseHexNumber(address);
  const count = /^\d+$/.test(length) ? Number(length) : NaN;
  const wAddr = parseHexNumber(writeAddress);
  const wData = parseHexBytes(writeData);
  const connected = xcp?.connected ?? null;
  const disabled = busy || !xcp;

  return (
    <Panel id="xcp" title="Calibration (XCP)" status={connected ? 'Connected' : 'Not connected'}>
      <NeedsCapture channel={settings.channel} />
      <div className="bw-controls">
        <ControlRow>
          <button type="button" className="bw-button bw-primary" disabled={disabled || !!connected} onClick={() => void run('FF 00', async () => {
            const c = await xcp!.connect();
            return { title: `Connected · ${c.byteOrder}-endian · up to ${c.maxCto} bytes per command`, detail: `resources 0x${c.resources.toString(16)} · protocol ${c.protocolVersion}.${c.transportVersion}` };
          })}>Connect</button>
          <button type="button" className="bw-button" disabled={disabled || !connected} onClick={() => void run('FD', async () => {
            const s = await xcp!.getStatus();
            return { title: `Status read · session 0x${s.sessionStatus.toString(16)} · protection 0x${s.resourceProtection.toString(16)}` };
          })}>Get status</button>
          <button type="button" className="bw-button" disabled={disabled || !connected} onClick={() => void run('FE', async () => {
            await xcp!.disconnect();
            return { title: 'Disconnected' };
          })}>Disconnect</button>
        </ControlRow>
        <ControlRow>
          <label className="bw-field bw-inline">
            <span>Address (hex)</span>
            <input className="bw-mono" value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Read address" spellCheck={false} />
          </label>
          <label className="bw-field bw-inline">
            <span>Bytes</span>
            <input className="bw-mono bw-narrow" value={length} onChange={(e) => setLength(e.target.value)} inputMode="numeric" aria-label="Read length" />
          </label>
          <button type="button" className="bw-button" disabled={disabled || !connected || addr === null || !(count >= 1 && count <= 256)} onClick={() => void run(`read ${count} @ ${address}`, async () => {
            const bytes = await xcp!.readMemory(addr!, count);
            return { title: `Read ${bytes.length} bytes`, detail: memoryDump(addr!, bytes) };
          })}>Read memory</button>
        </ControlRow>
        <ControlRow>
          <label className="bw-field bw-inline">
            <span>Write at (hex)</span>
            <input className="bw-mono" value={writeAddress} onChange={(e) => { setWriteAddress(e.target.value); setConfirm(false); }} aria-label="Write address" spellCheck={false} />
          </label>
          <label className="bw-field bw-inline bw-grow">
            <span>Data (hex)</span>
            <input className="bw-mono" value={writeData} onChange={(e) => { setWriteData(e.target.value); setConfirm(false); }} aria-label="Write data" spellCheck={false} />
          </label>
          <button
            type="button"
            className={`bw-button ${confirm ? 'bw-danger' : ''}`}
            disabled={disabled || !connected || wAddr === null || !wData || wData.length === 0}
            onClick={() => {
              if (!confirm) return setConfirm(true);
              setConfirm(false);
              void run(`write ${wData!.length} @ ${writeAddress}`, async () => {
                await xcp!.writeMemory(wAddr!, wData!);
                return { title: `Wrote ${wData!.length} bytes`, detail: memoryDump(wAddr!, wData!) };
              });
            }}
          >
            {confirm ? `Confirm: write ${wData?.length ?? 0} bytes` : 'Write memory'}
          </button>
        </ControlRow>
      </div>
      {error && <p className="bw-inline-error" role="alert">{error}</p>}
      <p className="bw-fine">Reads and writes memory at the addresses you type, using the XCP commands CONNECT, SET_MTA, UPLOAD and DOWNLOAD. Data acquisition, programming and address-file parsing are not included.</p>
      <DiagLog entries={log} label="Calibration log" />
    </Panel>
  );
}
