// Source-agnostic data model. A data source (a CAN device today, a DAQ device, a log file or a simulator
// later) says what kinds of data it provides; panels say what kinds they accept. Nothing here knows CAN.

/** frames: raw bus frames. signals: named scalar values with a unit. series: time-ordered samples of one signal. */
export type DataKind = 'frames' | 'signals' | 'series';

export type SourceKind = 'can-device' | 'daq-device' | 'log-file' | 'simulator';

export interface SignalInfo {
  /** Stable key within one source. */
  id: string;
  name: string;
  unit?: string;
  /** Nominal samples per second, when the source knows it. */
  sampleRateHz?: number;
  /** value = raw * factor + offset, applied by the source before it publishes. Informational for panels. */
  factor?: number;
  offset?: number;
}

export interface Sample {
  signalId: string;
  /** Source-side monotonic time in nanoseconds (never converted to a double). */
  timestampNs: bigint;
  value: number;
}

export interface SourceDescriptor {
  id: string;
  kind: SourceKind;
  label: string;
  provides: readonly DataKind[];
}

export type SampleListener = (sample: Sample) => void;

/** What signal panels need from a source. CAN-frame panels keep using the device store directly. */
export interface SignalSource {
  readonly descriptor: SourceDescriptor;
  signals(): readonly SignalInfo[];
  latest(signalId: string): Sample | undefined;
  subscribe(listener: SampleListener): () => void;
}

/** True when a panel that accepts `accepts` can show something from a source that provides `provides`. */
export function acceptsAny(accepts: readonly DataKind[] | 'any', provides: readonly DataKind[]): boolean {
  return accepts === 'any' || accepts.some((kind) => provides.includes(kind));
}
