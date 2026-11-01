import type { SourceDescriptor } from './model';
import type { WorkspaceState } from '../state/store';

/** The CAN device as a data source: raw frames, and named scalar signals once a database (DBC) is loaded. */
export function canSourceDescriptor(state: Pick<WorkspaceState, 'descriptor' | 'target'>, hasDatabase = false): SourceDescriptor {
  return {
    id: state.descriptor?.deviceId ?? state.target,
    kind: 'can-device',
    label: state.descriptor?.deviceId ?? 'CAN device',
    // With a database loaded the device also provides named, scaled signals.
    provides: hasDatabase ? ['frames', 'signals'] : ['frames'],
  };
}
