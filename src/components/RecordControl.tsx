import { useState } from 'react';
import { FORMATS, formatSpec, type RecordFormat } from '../record/formats';
import { useRecording } from '../record/context';
import { useHub } from '../state/context';
import { IconRecord, IconStop } from './icons';

/** BLF needs the browser's built-in compression; where it is missing the option is not offered, so a recording can never be lost at the end. */
const AVAILABLE_FORMATS = FORMATS.filter((f) => !f.binary || typeof CompressionStream !== 'undefined');

const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

/** Record the active device's frames to a file. The file is built in this browser and saved with a download; nothing is uploaded. */
export function RecordControl() {
  const hub = useHub();
  const service = useRecording();
  const [format, setFormat] = useState<RecordFormat>('asc');
  const recorder = service.current;
  const store = hub.active.store;
  const connected = store.getState().phase === 'connected';

  const save = async () => {
    const done = await service.stop();
    if (!done) return;
    const url = URL.createObjectURL(done.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = done.summary.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const last = service.last;
  // U8: the status is ellipsised at 240 px. Keep the whole text on `title` so the full file name
  // and its size can be read on hover (role=status already gives screen readers the whole string).
  const recordingText = recorder
    ? recorder.capped
      ? `Stopped at the ${formatBytes(recorder.capBytes)} limit · ${recorder.frames.toLocaleString()} frames · save it now`
      : `Recording · ${recorder.frames.toLocaleString()} frames · ${formatBytes(recorder.bytes)}${recorder.dropped > 0 ? ` · ${recorder.dropped.toLocaleString()} reported lost by the device` : ''}`
    : null;
  const savedText = !recorder && last
    ? `Saved ${last.fileName} · ${last.frames.toLocaleString()} frames · ${formatBytes(last.bytes)}${last.dropped > 0 ? ` · the device reported ${last.dropped.toLocaleString()} lost frames${last.carriesDrops ? ' (noted in the file)' : '; this format cannot note that, ASC can'}` : ''}${last.capped ? ' · stopped at the size limit' : ''}`
    : null;
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
    </>
  );
}
