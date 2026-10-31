import { createCloudClient, CloudError, type CloudClient } from './cloud/client';
import { cloudSession, type CloudSession } from './cloud/session';
import { detectBrowser } from './lib/browser';
import { queryLocalNetworkPermission } from './lib/permission';
import { DeviceHub } from './state/hub';
import { WorkspacePersistence } from './state/persistence';
import { defaultEnv, WorkspaceStore } from './state/store';
import { transportFactoryFor } from './transport/factory';
import type { RemoteFailureReason } from './transport/notices';
import { REMOTE_TARGET_PREFIX, RemoteTransport, type RemoteCredentials } from './transport/remote';
import { TransportOpenError, type CloseInfo, type DeviceTransport } from './transport/types';
import { WebSocketTransport } from './transport/websocket';

export interface CloudDeps {
  client: CloudClient;
  session: CloudSession;
}

const defaultCloudDeps: CloudDeps = { client: createCloudClient(), session: cloudSession };

/** A credential step failed. The reason is what the notice explains; the cause is kept out of the message. */
class RemoteSetupError extends Error {
  constructor(readonly reason: RemoteFailureReason) {
    super(`remote setup failed: ${reason}`);
    this.name = 'RemoteSetupError';
  }
}

const CODE_REASONS: Partial<Record<CloudError['code'], RemoteFailureReason>> = {
  forbidden: 'no-access',
  'not-found': 'not-found',
};

/** Maps one cloud step's failure to a reason. Only the account-token step can mean "signed out". */
function setupReason(error: unknown, accountStep: boolean): RemoteFailureReason {
  if (error instanceof CloudError) {
    if (accountStep && error.code === 'unauthorized') return 'not-signed-in';
    const mapped = CODE_REASONS[error.code];
    if (mapped) return mapped;
  }
  return 'cloud-unavailable';
}

/**
 * Relay ticket and ICE servers for one device. The account token is used only for the ticket request;
 * the ICE request carries the ticket. Failures are thrown as RemoteSetupError with a reason, never with a response body.
 */
async function getCredentials(deps: CloudDeps, projectId: string, deviceUuid: string): Promise<RemoteCredentials> {
  const token = deps.session.getToken();
  if (token === null) throw new RemoteSetupError('not-signed-in');
  let ticket: string;
  try {
    ({ ticket } = await deps.client.createBrowserTicket(token, projectId, deviceUuid));
  } catch (error) {
    // The server rejected the account token: forget it, so the page shows the signed-out state.
    if (error instanceof CloudError && error.code === 'unauthorized') deps.session.clear();
    throw new RemoteSetupError(setupReason(error, true));
  }
  try {
    const { iceServers } = await deps.client.fetchIceServers(ticket, projectId, deviceUuid);
    return { ticket, iceServers };
  } catch (error) {
    throw new RemoteSetupError(setupReason(error, false));
  }
}

/**
 * A RemoteTransport that reports the cloud reason when the link cannot open. RemoteTransport itself only reports a
 * generic "credentials unavailable" for a failed getCredentials, so the reason is kept here and used in its place.
 */
function cloudRemoteTransport(projectId: string, deviceUuid: string, deps: CloudDeps): DeviceTransport {
  let setupFailure: TransportOpenError | null = null;
  const inner = new RemoteTransport(`${REMOTE_TARGET_PREFIX}${projectId}/${deviceUuid}`, {
    getCredentials: async (project, device) => {
      try {
        return await getCredentials(deps, project, device);
      } catch (error) {
        const reason: RemoteFailureReason = error instanceof RemoteSetupError ? error.reason : 'cloud-unavailable';
        const info: CloseInfo = { phase: 'connecting', code: null, reason, wasClean: false, initiatedBy: 'local' };
        setupFailure = new TransportOpenError(info, `remote setup failed: ${reason}`);
        throw setupFailure;
      }
    },
  });
  return {
    get kind() {
      return inner.kind;
    },
    get target() {
      return inner.target;
    },
    setListener: (listener) => inner.setListener(listener),
    // The stages of the open are what the connecting screen shows; the wrapper must pass them on.
    onStage: (listener) => inner.onStage(listener),
    open: async () => {
      try {
        await inner.open();
      } catch (error) {
        throw setupFailure ?? error;
      }
    },
    send: (message) => inner.send(message),
    close: () => inner.close(),
  };
}

/** Transports for `remote:` targets. Each connection attempt gets its own relay link. Exported for tests. */
export function cloudRemoteFactory(deps: CloudDeps = defaultCloudDeps): (projectId: string, deviceUuid: string) => DeviceTransport {
  return (projectId, deviceUuid) => cloudRemoteTransport(projectId, deviceUuid, deps);
}

/** The production wiring: WebSocket adapter, cloud relay for remote targets, real browser detection, real permission query. One store per device. */
export function createStore(deps: CloudDeps = defaultCloudDeps): WorkspaceStore {
  return new WorkspaceStore(
    defaultEnv({
      transportFactory: transportFactoryFor({
        webSocket: (target) => new WebSocketTransport(target),
        remote: cloudRemoteFactory(deps),
      }),
      browser: detectBrowser(),
      queryPermission: queryLocalNetworkPermission,
    }),
  );
}

export function createHub(): DeviceHub {
  return new DeviceHub(() => createStore(), undefined, new WorkspacePersistence());
}
