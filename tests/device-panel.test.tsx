import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DevicePanel } from '../src/components/DevicePanel';
import { StoreProvider } from '../src/state/context';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import type { ConnectionPath, LinkTraffic } from '../src/transport/types';
import { FakeTransport } from './helpers/fakes';
import { MockDeviceCore } from './helpers/mockDevice';

/** A link that reports the path the test sets; a null path never resolves, so the first check stays pending. */
class PanelTransport extends FakeTransport {
  path: ConnectionPath | 'pending' = 'pending';
  counters: LinkTraffic | null = null;
  async connectionPath(): Promise<ConnectionPath> {
    if (this.path === 'pending') return new Promise<ConnectionPath>(() => undefined);
    return this.path;
  }
  async traffic(): Promise<LinkTraffic | null> {
    return this.counters;
  }
}

let store: WorkspaceStore | null = null;
afterEach(() => {
  cleanup();
  store?.disconnect();
  store = null;
});

async function connectedPanel(path: ConnectionPath | 'pending', counters: LinkTraffic | null = null) {
  const device = new MockDeviceCore();
  let transport: PanelTransport | null = null;
  store = new WorkspaceStore(defaultEnv({
    transportFactory: (target) => {
      transport = new PanelTransport(target, device);
      transport.path = path;
      transport.counters = counters;
      return transport;
    },
    browser: { family: 'chromium', name: 'Chrome', supported: true },
    queryPermission: async () => 'unknown',
    schedule: (fn) => fn(),
  }));
  const current = store;
  await act(async () => {
    await current.connect('localhost:9101');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  render(<StoreProvider store={current}><DevicePanel /></StoreProvider>);
  return current;
}

function connectionRow(): HTMLElement {
  const dt = screen.getByText('Connection');
  return dt.parentElement!.querySelector('dd') as HTMLElement;
}

describe('DevicePanel connection row', () => {
  it('says direct on the local network for a WebSocket link', async () => {
    await connectedPanel({ kind: 'local-network' });
    expect(connectionRow()).toHaveTextContent('Direct on your local network · session 1');
  });

  it('says direct, peer to peer, with the candidate kinds in technical details', async () => {
    await connectedPanel({ kind: 'direct', local: 'srflx', remote: 'host', protocol: 'udp' });
    expect(connectionRow()).toHaveTextContent('Direct, peer to peer (no Plotune relay) · session 1');
    expect(connectionRow()).not.toHaveTextContent('relay traffic is metered');
    expect(screen.getByText(/connection path: local srflx ↔ remote host · udp/)).toBeInTheDocument();
  });

  it('says through the Plotune relay, with the cost hint and byte counters for a TURN link', async () => {
    await connectedPanel({ kind: 'relay', protocol: 'tls' }, { bytesSent: 2048, bytesReceived: 4096 });
    expect(connectionRow()).toHaveTextContent('Through the Plotune relay (TURN) · session 1');
    expect(connectionRow()).toHaveTextContent('Slower than a direct link; relay traffic is metered');
    expect(screen.getByText(/connection path: relay \(TURN\) · tls · sent 2,048 bytes · received 4,096 bytes/)).toBeInTheDocument();
  });

  it('says checking while the first check has not finished', async () => {
    await connectedPanel('pending');
    expect(connectionRow()).toHaveTextContent('Checking the connection… · session 1');
    expect(screen.getByText(/connection path: checking/)).toBeInTheDocument();
  });

  it('says unknown when the check reports unknown', async () => {
    await connectedPanel({ kind: 'unknown' });
    expect(connectionRow()).toHaveTextContent('Unknown · session 1');
  });

  it('has no connection row before a device is connected', () => {
    store = new WorkspaceStore(defaultEnv({
      transportFactory: (target) => new FakeTransport(target, new MockDeviceCore()),
      browser: { family: 'chromium', name: 'Chrome', supported: true },
      queryPermission: async () => 'unknown',
      schedule: (fn) => fn(),
    }));
    render(<StoreProvider store={store}><DevicePanel /></StoreProvider>);
    expect(screen.queryByText('Connection')).toBeNull();
  });
});
