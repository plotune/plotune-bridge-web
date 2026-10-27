import { detectBrowser } from './lib/browser';
import { queryLocalNetworkPermission } from './lib/permission';
import { defaultEnv, WorkspaceStore } from './state/store';
import { WebSocketTransport } from './transport/websocket';

/** The production wiring: WebSocket adapter, real browser detection, real permission query. */
export function createStore(): WorkspaceStore {
  return new WorkspaceStore(
    defaultEnv({
      transportFactory: (target) => new WebSocketTransport(target),
      browser: detectBrowser(),
      queryPermission: queryLocalNetworkPermission,
    }),
  );
}
