import { detectBrowser } from './lib/browser';
import { queryLocalNetworkPermission } from './lib/permission';
import { DeviceHub } from './state/hub';
import { WorkspacePersistence } from './state/persistence';
import { defaultEnv, WorkspaceStore } from './state/store';
import { WebSocketTransport } from './transport/websocket';

/** The production wiring: WebSocket adapter, real browser detection, real permission query. One store per device. */
export function createStore(): WorkspaceStore {
  return new WorkspaceStore(
    defaultEnv({
      transportFactory: (target) => new WebSocketTransport(target),
      browser: detectBrowser(),
      queryPermission: queryLocalNetworkPermission,
    }),
  );
}

export function createHub(): DeviceHub {
  return new DeviceHub(createStore, undefined, new WorkspacePersistence());
}
