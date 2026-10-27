// Several devices at once. Each device keeps its own store (connection, channels, trace, counters); the hub only
// adds the list, which device is selected, a merged trace and the all-devices capture actions.
import { TraceBuffer, type TraceRow } from './trace';
import type { WorkspaceStore } from './store';

export interface Slot {
  id: string;
  /** Stable name for this page visit ("Bridge 1"); rows in the merged trace carry it. */
  label: string;
  store: WorkspaceStore;
}

export interface HubState {
  slots: Slot[];
  activeId: string;
  /** Which trace the Trace panel shows: every device merged, or one device. */
  traceView: 'all' | string;
  /** Changes whenever the hub or any device changes, so views can re-read. */
  rev: number;
}

export const MAX_DEVICES = 8;

export class DeviceHub {
  /** Rows of every device in the order they arrived here. Device clocks are not synchronised, so this is not time order. */
  readonly merged = new TraceBuffer(50_000);
  private state: HubState;
  private readonly listeners = new Set<() => void>();
  private counter = 0;
  private notifyQueued = false;

  constructor(
    private readonly makeStore: () => WorkspaceStore,
    private readonly schedule: (fn: () => void) => void = (fn) => setTimeout(fn, 16),
  ) {
    const first = this.create();
    this.state = { slots: [first], activeId: first.id, traceView: 'all', rev: 0 };
  }

  getState = (): HubState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<HubState>): void {
    this.state = { ...this.state, ...patch, rev: this.state.rev + 1 };
    this.queueNotify();
  }

  private queueNotify(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    this.schedule(() => {
      this.notifyQueued = false;
      this.listeners.forEach((l) => l());
    });
  }

  private create(): Slot {
    this.counter += 1;
    const store = this.makeStore();
    const slot: Slot = { id: `d${this.counter}`, label: `Bridge ${this.counter}`, store };
    store.trace.onPush = (row) => {
      const copy: Partial<TraceRow> = { ...row, device: slot.label, originNs: store.trace.originNs ?? undefined };
      delete copy.key;
      this.merged.push(copy as Parameters<TraceBuffer['push']>[0]);
    };
    // Any change in a device is a change in the hub's summary (toolbar, setup list).
    store.subscribe(() => this.set({}));
    return slot;
  }

  slot(id: string): Slot | undefined {
    return this.state.slots.find((s) => s.id === id);
  }

  get active(): Slot {
    return this.slot(this.state.activeId) ?? this.state.slots[0];
  }

  /** Adds an empty device entry and selects it; the caller shows the address form for it. */
  addDevice(): Slot | null {
    if (this.state.slots.length >= MAX_DEVICES) return null;
    const slot = this.create();
    this.set({ slots: [...this.state.slots, slot], activeId: slot.id });
    return slot;
  }

  /** Disconnects and forgets a device. The last device cannot be removed; it is reset to the address form instead. */
  removeDevice(id: string): void {
    const slot = this.slot(id);
    if (!slot) return;
    slot.store.disconnect();
    slot.store.reset();
    if (this.state.slots.length === 1) return;
    slot.store.trace.onPush = null;
    const slots = this.state.slots.filter((s) => s.id !== id);
    this.set({
      slots,
      activeId: this.state.activeId === id ? slots[0].id : this.state.activeId,
      traceView: this.state.traceView === id ? 'all' : this.state.traceView,
    });
  }

  select(id: string): void {
    if (this.slot(id)) this.set({ activeId: id });
  }

  setTraceView(view: 'all' | string): void {
    this.set({ traceView: view === 'all' || this.slot(view) ? view : 'all' });
  }

  /** The buffer the Trace panel reads: with one device that device's own trace, otherwise the merged one or the chosen device's. */
  traceBuffer(): TraceBuffer {
    const { slots, traceView } = this.state;
    if (slots.length === 1) return slots[0].store.trace;
    if (traceView === 'all') return this.merged;
    return this.slot(traceView)?.store.trace ?? this.merged;
  }

  clearTraces(): void {
    this.merged.clear();
    this.state.slots.forEach((s) => s.store.clearTrace());
    this.set({});
  }

  // -- all-device actions ---------------------------------------------------------------------

  connected(): Slot[] {
    return this.state.slots.filter((s) => s.store.getState().phase === 'connected');
  }

  async startAll(): Promise<void> {
    await Promise.all(this.connected().filter((s) => !s.store.getState().capturing).map((s) => s.store.startCapture()));
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.connected().filter((s) => s.store.getState().capturing).map((s) => s.store.stopCapture()));
  }
}
