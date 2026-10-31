// Picks the transport for a target string: `remote:` targets go through the cloud relay, everything else over the local WebSocket.
import { isRemoteTarget, parseRemoteTarget } from './remote';
import type { DeviceTransport, TransportFactory } from './types';

export interface TransportFactories {
  webSocket: TransportFactory;
  remote: (projectId: string, deviceUuid: string) => DeviceTransport;
}

/** Throws TypeError for a malformed `remote:` target; that is a caller bug, not a device condition. */
export function transportFactoryFor({ webSocket, remote }: TransportFactories): TransportFactory {
  return (target) => {
    if (!isRemoteTarget(target)) return webSocket(target);
    const parsed = parseRemoteTarget(target);
    if (!parsed) throw new TypeError('the remote target must be remote:<projectId>/<deviceUuid>');
    return remote(parsed.projectId, parsed.deviceUuid);
  };
}
