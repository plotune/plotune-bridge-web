// Several devices at once. Each device keeps its own store (connection, channels, trace, counters); the hub only
// adds the list, which device is selected, a merged trace and the all-devices capture actions.
import { TraceBuffer, type TraceRow } from './trace';
import type { WorkspaceStore } from './store';
import { emptyWorkspace, PANEL_IDS, rememberableTarget, type PageId, type SavedDevice, type SavedWorkspace, type WorkspacePersistence } from './persistence';
import type { DiagSettings } from '../diagnostics/settings';
import { isRemoteTarget } from '../transport/remote';

export interface Slot {
  id: string;
  /** Stable name for this page visit ("Bridge 1"); rows in the merged trace carry it. */
  label: string;
  store: WorkspaceStore;
  remembered: boolean;
}

export interface HubState {
  slots: Slot[];
  activeId: string;
  /** Which trace the Trace panel shows: every device merged, or one device. */
  traceView: 'all' | string;
  /** Changes whenever the hub or any device changes, so views can re-read. */
  rev: number;
  editingId: string | null;
  page: PageId;
  hidden: SavedWorkspace['hidden'];
  diagnostics: DiagSettings;
  permissionExplained: boolean;
}

export const MAX_DEVICES = 8;

export class DeviceHub {
  /** Rows of every device in the order they arrived here. Device clocks are not synchronised, so this is not time order. */
  readonly merged = new TraceBuffer(50_000);
  private state: HubState;
  private readonly listeners = new Set<() => void>();
  private counter = 0;
  private notifyQueued = false;
  private readonly subscriptions = new Map<string, () => void>();
  private readonly empty: Slot;
  /** The last accepted endpoint, separate from an in-flight/failed address edit. */
  private readonly connectedTargets = new Map<string, string>();

  constructor(
    private readonly makeStore: () => WorkspaceStore,
    private readonly schedule: (fn: () => void) => void = (fn) => setTimeout(fn, 16),
    private readonly persistence?: WorkspacePersistence,
  ) {
    const saved = persistence?.load() ?? emptyWorkspace();
    this.empty = { id: '', label: '', store: makeStore(), remembered: false }; // offline panel context, never a listed device
    this.state = { slots: [], activeId: saved.activeId, traceView: saved.traceView, rev: 0, editingId: null,
      page: saved.page, hidden: saved.hidden, diagnostics: saved.diagnostics, permissionExplained: saved.permissionExplained };
    this.state.slots = saved.devices.map((d) => this.create(d));
    this.counter = Math.max(0, ...this.state.slots.map((s) => Number(s.id.slice(1))));
  }

  getState = (): HubState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<HubState>, coalesce = false): void {
    this.state = { ...this.state, ...patch, rev: this.state.rev + 1 };
    this.persist();
    if (coalesce) this.queueNotify();
    else this.listeners.forEach((listener) => listener());
  }

  private queueNotify(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    this.schedule(() => {
      this.notifyQueued = false;
      this.listeners.forEach((l) => l());
    });
  }

  private persist(): void {
    const devices = this.state.slots.flatMap((slot) => {
      const s = slot.store.getState();
      const target = rememberableTarget(this.connectedTargets.get(slot.id));
      return target && slot.remembered ? [{ id: slot.id, label: slot.label, target, captureChannels: s.captureChannels, transmitChannel: s.transmitChannel }] : [];
    });
    this.persistence?.save({ version: 1, devices, activeId: this.state.activeId, traceView: this.state.traceView,
      page: this.state.page, hidden: this.state.hidden, diagnostics: this.state.diagnostics, permissionExplained: this.state.permissionExplained });
  }

  private create(saved?: SavedDevice): Slot {
    this.counter += 1;
    const store = this.makeStore();
    if (saved) store.restorePreferences(saved);
    const slot: Slot = { id: saved?.id ?? `d${this.counter}`, label: saved?.label ?? `Bridge ${this.counter}`, store, remembered: !!saved };
    if (saved) this.connectedTargets.set(slot.id, saved.target);
    store.trace.onPush = (row) => {
      const copy: Partial<TraceRow> = { ...row, device: slot.label, originNs: store.trace.originNs ?? undefined };
      delete copy.key;
      this.merged.push(copy as Parameters<TraceBuffer['push']>[0]);
    };
    this.subscriptions.set(slot.id, store.subscribe(() => {
      if (store.getState().phase === 'connected') {
        slot.remembered = true;
        this.connectedTargets.set(slot.id, store.getState().target);
      }
      this.set({ ...(this.state.editingId === slot.id && store.getState().phase === 'connected' ? { editingId: null } : {}) }, true);
    }));
    return slot;
  }

  setPage(page: PageId): void { this.set({ page }); }
  explainPermission(): void { this.set({ permissionExplained: true }); }
  setDiagSettings(patch: Partial<DiagSettings>): void { this.set({ diagnostics: { ...this.state.diagnostics, ...patch } }); }
  setPanelVisible(page: PageId, id: string, visible: boolean): void {
    if (!(PANEL_IDS[page] as readonly string[]).includes(id)) return;
    const hidden = new Set(this.state.hidden[page]);
    if (visible) hidden.delete(id); else hidden.add(id);
    this.set({ hidden: { ...this.state.hidden, [page]: [...hidden] } });
  }
  editDevice(id: string): void {
    const slot = this.slot(id);
    if (!slot) return;
    slot.store.disconnect();
    slot.store.reset();
    this.set({ activeId: id, editingId: id });
  }
  cancelEdit(): void {
    const slot = this.slot(this.state.editingId ?? '');
    if (!slot) return;
    const s = slot.store.getState();
    if (!slot.remembered) this.removeDevice(slot.id);
    else {
      slot.store.disconnect();
      slot.store.restorePreferences({ target: this.connectedTargets.get(slot.id)!, captureChannels: s.captureChannels, transmitChannel: s.transmitChannel });
      this.set({ editingId: null });
    }
  }

  slot(id: string): Slot | undefined {
    return this.state.slots.find((s) => s.id === id);
  }

  get active(): Slot {
    return this.slot(this.state.activeId) ?? this.empty;
  }

  /** Adds an empty device entry and selects it; the caller shows the address form for it. */
  addDevice(): Slot | null {
    if (this.state.slots.length >= MAX_DEVICES) return null;
    const slot = this.create();
    this.set({ slots: [...this.state.slots, slot], activeId: slot.id, editingId: slot.id });
    return slot;
  }

  /** Disconnects and forgets any device, including the last. The workspace stays open. */
  removeDevice(id: string): void {
    const slot = this.slot(id);
    if (!slot) return;
    slot.store.disconnect();
    slot.store.reset();
    this.subscriptions.get(id)?.();
    this.subscriptions.delete(id);
    this.connectedTargets.delete(id);
    slot.store.trace.onPush = null;
    const slots = this.state.slots.filter((s) => s.id !== id);
    const activeId = this.state.activeId === id ? (slots[0]?.id ?? '') : this.state.activeId;
    const next = slots.find((s) => s.id === activeId);
    this.set({
      slots,
      editingId: next && (!next.remembered || next.store.getState().phase === 'idle') ? next.id : this.state.editingId === id ? null : this.state.editingId,
      activeId,
      traceView: this.state.traceView === id ? 'all' : this.state.traceView,
    });
  }

  select(id: string): void {
    const slot = this.slot(id);
    if (slot) this.set({ activeId: id, ...(!slot.remembered || slot.store.getState().phase === 'idle' ? { editingId: id } : {}) });
  }

  /**
   * Remembered remote devices restored in the needs-sign-in state. Only these reconnect automatically after a sign-in:
   * a device the user added in this page, or any direct address, is never started by the sign-in.
   */
  remoteAwaitingSignIn(): Slot[] {
    return this.state.slots.filter((slot) => this.isAwaitingSignIn(slot));
  }

  /** True while this device is still in the hub, remembered, closed and waiting for a sign-in. Rechecked before each reconnect. */
  isAwaitingSignIn(slot: Slot): boolean {
    if (this.slot(slot.id) !== slot) return false;
    const state = slot.store.getState();
    return slot.remembered && isRemoteTarget(state.target) && state.phase === 'closed' && state.notice?.kind === 'signed-out';
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
