import { useState } from 'react';
import { FORMATS, FIELD_LABELS, formatSpec, type RecordFormat, type RecordingField } from '../record/formats';
import { useRecording } from '../record/context';
import { useHub } from '../state/context';
import { Modal } from '../workspace/ui';
import { IconRecord, IconStop } from './icons';

/** BLF needs the browser's built-in compression; where it is missing the option is not offered, so a recording can never be lost at the end. */
const AVAILABLE_FORMATS = FORMATS.filter((f) => !f.binary || typeof CompressionStream !== 'undefined');

const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);
const sameLossFields = (a: readonly RecordingField[], b: readonly RecordingField[] | null): boolean =>
  b !== null && a.length === b.length && a.every((field, index) => field === b[index]);

/** Record the active device's frames to a file. The file is built in this browser and saved with a download; nothing is uploaded. */
export function RecordControl() {
  const hub = useHub();
  const service = useRecording();
  const [format, setFormat] = useState<RecordFormat>('asc');
  const [lossPrompt, setLossPrompt] = useState<RecordingField[] | null>(null);
  const recorder = service.current;
  const store = hub.active.store;
  const connected = store.getState().phase === 'connected';

  const download = (done: { blob: Blob; summary: { fileName: string } }) => {
    const url = URL.createObjectURL(done.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = done.summary.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const save = async () => {
    const current = service.current;
    if (!current) return;
    // Do not stop the recording or create a file until the user explicitly accepts the loss.
    if (current.lossFields.length) {
      setLossPrompt(current.lossFields);
      return;
    }
    const done = await service.stop();
    if (done) download(done);
  };

  const exportAnyway = async () => {
    const current = service.current;
    if (!current) {
      setLossPrompt(null);
      return;
    }
    const live = current.lossFields;
    if (live.length === 0) {
      setLossPrompt(null);
      const done = await service.stop();
      if (done) download(done);
      return;
    }
    // Frames keep arriving while the confirmation is open. The consent only covers the fields
    // shown; if the recording gained a loss (for example an RTR frame adds the requested length),
    // re-present the dialog instead of exporting the newly lost field without consent.
    if (!sameLossFields(live, lossPrompt)) {
      setLossPrompt(live);
      return;
    }
    setLossPrompt(null);
    const done = await service.stop();
    if (done) download(done);
  };

  const lossLabels = lossPrompt?.map((field) => FIELD_LABELS[field]).join(', ') ?? '';
  const lastLossLabels = service.last?.lossFields.map((field) => FIELD_LABELS[field]).join(', ') ?? '';

  const last = service.last;
  // U8: the status is ellipsised at 240 px. Keep the whole text on `title` so the full file name
  // and its size can be read on hover (role=status already gives screen readers the whole string).
  const recordingText = recorder
    ? recorder.capped
      ? `Stopped at the ${formatBytes(recorder.capBytes)} limit · ${recorder.frames.toLocaleString()} frames · save it now`
      : `Recording · ${recorder.frames.toLocaleString()} frames · ${formatBytes(recorder.bytes)}${recorder.dropped > 0 ? ` · ${recorder.dropped.toLocaleString()} reported lost by the device` : ''}`
    : null;
  const savedText = !recorder && last
    ? `Saved ${last.fileName} · ${last.frames.toLocaleString()} frames · ${formatBytes(last.bytes)}${last.dropped > 0 ? ` · the device reported ${last.dropped.toLocaleString()} lost frames${last.carriesDrops ? ' (noted in the file)' : '; this format cannot note that, ASC can'}` : ''}${lastLossLabels ? ` · lossy: ${lastLossLabels}` : ''}${last.capped ? ' · stopped at the size limit' : ''}`
    : null;
  const exportLabel = recorder ? formatSpec(recorder.spec.id).label : 'selected';
  return (
    <>
      {!recorder && (
        <select className="bw-format-select" value={format} onChange={(e) => setFormat(e.target.value as RecordFormat)} aria-label="Recording format" title={`Recording format: ${formatSpec(format).label}`}>
          {AVAILABLE_FORMATS.map((f) => (
            // U4: the closed select is only 76 px, so show a short code. The full descriptive name
            // stays available on each option's title and on the control's title.
            <option key={f.id} value={f.id} title={f.label}>{f.shortLabel}</option>
          ))}
        </select>
      )}
      {recorder ? (
        <button type="button" className="bw-icon-button bw-record is-recording" aria-label="Stop and save" onClick={() => void save()} title="Stop recording and save the file">
          <IconStop />
        </button>
      ) : (
        <button type="button" className="bw-icon-button bw-record" aria-label="Record" disabled={!connected} onClick={() => service.start(store, format)} title={connected ? 'Record every frame of this device to a file' : 'Connect a device to record'}>
          <IconRecord />
        </button>
      )}
      {recorder ? (
        // The counts change with every frame, so this is deliberately not a live region; the button names say what state it is in.
        <span className="bw-fine bw-record-status" data-testid="record-status" title={recordingText!}>{recordingText}</span>
      ) : savedText ? (
        // Shown once, when a recording ends: announced to assistive technology.
        <span className="bw-fine bw-record-status" role="status" data-testid="record-status" title={savedText}>{savedText}</span>
      ) : null}
      {lossPrompt && (
        <Modal
          title="Export with loss?"
          onClose={() => setLossPrompt(null)}
          footer={
            <>
              <button type="button" className="bw-button" data-autofocus onClick={() => setLossPrompt(null)}>Cancel</button>
              <button type="button" className="bw-button bw-primary" onClick={() => void exportAnyway()}>Export anyway (lossy: {lossLabels})</button>
            </>
          }
        >
          <p>This {exportLabel} export cannot preserve: <strong>{lossLabels}</strong>.</p>
          <p>The recording is still running. Cancel to keep it, or export anyway and accept the listed loss.</p>
        </Modal>
      )}
    </>
  );
}
