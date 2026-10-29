import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { DeviceHub } from '../src/state/hub';
import { defaultEnv, WorkspaceStore } from '../src/state/store';

const browser = { family: 'chromium', name: 'Chrome', supported: true } as const;
afterEach(cleanup);

it('opens the main workspace and settings without a device or permission request', () => {
  const transportFactory = vi.fn();
  const queryPermission = vi.fn(async () => 'unknown' as const);
  const hub = new DeviceHub(() => new WorkspaceStore(defaultEnv({ transportFactory, queryPermission, browser })), (fn) => fn());
  render(<App hub={hub} browser={browser} />);
  expect(hub.getState().slots).toHaveLength(0);
  expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Trace' })).toBeVisible();
  expect(screen.queryByTestId('permission-explainer')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
  expect(screen.getByLabelText(/^Request ID \(hex\)/)).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /^Device$/ }));
  expect(screen.getByText('Not connected to a device.')).toBeVisible();
  expect(transportFactory).not.toHaveBeenCalled();
  expect(queryPermission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add a device' }));
  expect(screen.getByTestId('permission-explainer')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
  expect(hub.getState().slots).toHaveLength(0);
  expect(screen.queryByTestId('permission-explainer')).toBeNull();
  expect(queryPermission).not.toHaveBeenCalled();
});
