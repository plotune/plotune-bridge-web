import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { DeviceHub } from '../src/state/hub';
import { defaultEnv, WorkspaceStore } from '../src/state/store';
import { seededProject } from './helpers/project';
import { fakeSso } from './helpers/sso';

const browser = { family: 'chromium', name: 'Chrome', supported: true } as const;
const ADVANCED = 'Advanced: connect on the local network instead';
afterEach(cleanup);

it('opens the main workspace and settings without a device or permission request', () => {
  const transportFactory = vi.fn();
  const queryPermission = vi.fn(async () => 'unknown' as const);
  const hub = new DeviceHub(() => new WorkspaceStore(defaultEnv({ transportFactory, queryPermission, browser })), (fn) => fn());
  render(<App hub={hub} browser={browser} cloudSso={fakeSso()} project={seededProject()} />);
  expect(hub.getState().slots).toHaveLength(0);
  expect(screen.getByRole('navigation', { name: 'Canvases' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Trace' })).toBeVisible();
  expect(screen.queryByTestId('permission-explainer')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
  // The link settings are not on the canvas: a one-line summary names the link, and the gear opens them.
  expect(screen.getAllByTestId('link-summary')[0]).toHaveTextContent('CAN1 · requests 7E0 → answers 7E8 · calibration 600 → 601');
  expect(screen.queryByLabelText(/^Request ID \(hex\)/)).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Diagnostic link settings' })[0]!);
  const dialog = screen.getByRole('dialog', { name: 'Diagnostic link' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Edit settings' }));
  expect(within(dialog).getByRole('button', { name: 'Hide settings' })).toHaveAttribute('aria-expanded', 'true');
  expect(within(dialog).getByLabelText(/^Request ID \(hex\)/)).toBeEnabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(screen.getAllByRole('button', { name: 'Start session' })[0]).toBeDisabled();
  expect(transportFactory).not.toHaveBeenCalled();
  expect(queryPermission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add a device' }));
  fireEvent.click(screen.getByRole('button', { name: ADVANCED }));
  expect(screen.getByTestId('permission-explainer')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
  expect(hub.getState().slots).toHaveLength(0);
  expect(screen.queryByTestId('permission-explainer')).toBeNull();
  expect(queryPermission).not.toHaveBeenCalled();
});

it('reopens an unfinished device connection form after adding and selecting another draft', () => {
  const hub = new DeviceHub(() => new WorkspaceStore(defaultEnv({
    transportFactory: vi.fn(), queryPermission: async () => 'unknown', browser,
  })), (fn) => fn());
  render(<App hub={hub} browser={browser} cloudSso={fakeSso()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add a device' }));
  fireEvent.click(screen.getByRole('button', { name: ADVANCED }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add a device' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select Bridge 1' }));
  fireEvent.click(screen.getByRole('button', { name: ADVANCED }));
  expect(screen.getByLabelText('Device address')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
  expect(hub.getState().slots).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: ADVANCED }));
  expect(screen.getByLabelText('Device address')).toBeVisible();
});

it('shows the link form on its own, and keeps it open, while the settings are invalid', () => {
  const transportFactory = vi.fn();
  const queryPermission = vi.fn(async () => 'unknown' as const);
  const hub = new DeviceHub(() => new WorkspaceStore(defaultEnv({ transportFactory, queryPermission, browser })), (fn) => fn());
  render(<App hub={hub} browser={browser} cloudSso={fakeSso()} project={seededProject()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Diagnostic link settings' })[0]!);
  const dialog = screen.getByRole('dialog', { name: 'Diagnostic link' });
  expect(within(dialog).getByLabelText(/^Request ID \(hex\)/)).not.toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Edit settings' }));
  fireEvent.change(within(dialog).getByLabelText(/^Request ID \(hex\)/), { target: { value: 'zz' } });
  expect(within(dialog).getByRole('alert')).toHaveTextContent(/use hex digits/);
  expect(within(dialog).getByRole('button', { name: 'Hide settings' })).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText(/^Request ID \(hex\)/), { target: { value: '7E0' } });
  expect(within(dialog).queryByRole('alert')).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hide settings' }));
  expect(within(dialog).getByLabelText(/^Request ID \(hex\)/)).not.toBeVisible();
});
