import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ChannelsPanel } from '../src/components/ChannelsPanel';
import { StoreProvider } from '../src/state/context';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { FakeTransport } from './helpers/fakes';
import { MockDeviceCore } from './helpers/mockDevice';

let store: WorkspaceStore;
afterEach(() => { cleanup(); store?.disconnect(); });

it('leaves CAN2 visibly idle and lets it be configured while CAN1 captures', async () => {
  const device = new MockDeviceCore();
  store = new WorkspaceStore(defaultEnv({
    transportFactory: (target) => new FakeTransport(target, device),
    browser: { family: 'chromium', name: 'Chrome', supported: true },
    queryPermission: async () => 'unknown', schedule: (fn) => fn(),
  }));
  await store.connect('localhost:9101');
  await store.setBitrate(1, 500000);
  render(<StoreProvider store={store}><ChannelsPanel /></StoreProvider>);
  const can2 = screen.getByTestId('channel-2');
  expect(within(can2).getByText(/Idle · set a bit rate/)).toBeVisible();
  expect(within(can2).getByRole('checkbox')).not.toBeChecked();
  expect(within(can2).getByRole('checkbox')).toBeDisabled();
  await act(() => store.startCapture());
  expect(screen.getByLabelText('CAN1 bit rate')).toBeDisabled();
  expect(screen.getByLabelText('CAN2 bit rate')).toBeEnabled();
  expect(within(can2).queryByText('Capturing')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('applies capture checkbox choices in the input event even when frame notifications are batched', async () => {
  const device = new MockDeviceCore();
  const queued: (() => void)[] = [];
  store = new WorkspaceStore(defaultEnv({
    transportFactory: (target) => new FakeTransport(target, device),
    browser: { family: 'chromium', name: 'Chrome', supported: true },
    queryPermission: async () => 'unknown', schedule: (fn) => queued.push(fn),
  }));
  await store.connect('localhost:9101');
  await store.setBitrate(1, 500000);
  render(<StoreProvider store={store}><ChannelsPanel /></StoreProvider>);
  const checkbox = within(screen.getByTestId('channel-1')).getByRole('checkbox');
  expect(checkbox).toBeChecked();
  act(() => checkbox.click());
  expect(checkbox).not.toBeChecked();
});
