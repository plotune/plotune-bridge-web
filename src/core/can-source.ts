import type { SourceDescriptor } from './model';
import type { WorkspaceState } from '../state/store';

/** The CAN device as a data source: it provides raw frames. Scalar signals arrive with DBC decoding (#11). */
export function canSourceDescriptor(state: Pick<WorkspaceState, 'descriptor' | 'target'>): SourceDescriptor {
  return {
    id: state.descriptor?.deviceId ?? state.target,
    kind: 'can-device',
    label: state.descriptor?.deviceId ?? 'CAN device',
    provides: ['frames'],
  };
}
