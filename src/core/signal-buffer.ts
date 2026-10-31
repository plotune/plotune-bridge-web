import type { Sample, SampleListener, SignalInfo, SignalSource, SourceDescriptor } from './model';

/** An in-memory SignalSource. Adapters (a DAQ transport, a log reader, a simulator) push samples into it. */
export class SignalBuffer implements SignalSource {
  private readonly infos = new Map<string, SignalInfo>();
  private readonly last = new Map<string, Sample>();
  private readonly listeners = new Set<SampleListener>();
  private readonly versionListeners = new Set<() => void>();
  private version = 0;

  constructor(readonly descriptor: SourceDescriptor, signals: readonly SignalInfo[] = []) {
    for (const info of signals) this.infos.set(info.id, info);
  }

  signals(): readonly SignalInfo[] {
    return [...this.infos.values()];
  }

  latest(signalId: string): Sample | undefined {
    return this.last.get(signalId);
  }

  /** Changes on every push so a UI can re-read cheaply. */
  getVersion = (): number => this.version;

  declare(info: SignalInfo): void {
    this.infos.set(info.id, info);
    this.version += 1;
    for (const listener of this.versionListeners) listener();
  }

  /** Samples for a signal the source never declared are dropped: panels must not invent channels. */
  push(sample: Sample): boolean {
    if (!this.infos.has(sample.signalId) || !Number.isFinite(sample.value)) return false;
    this.last.set(sample.signalId, sample);
    this.version += 1;
    for (const listener of this.listeners) listener(sample);
    for (const listener of this.versionListeners) listener();
    return true;
  }

  /** For useSyncExternalStore: called after any declare or accepted push. */
  onChange = (listener: () => void): (() => void) => {
    this.versionListeners.add(listener);
    return () => this.versionListeners.delete(listener);
  };

  subscribe(listener: SampleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
