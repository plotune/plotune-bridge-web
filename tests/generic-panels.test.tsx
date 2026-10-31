import { render, screen, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { acceptsAny, type SourceDescriptor } from '../src/core/model';
import { SignalBuffer } from '../src/core/signal-buffer';
import { canSourceDescriptor } from '../src/core/can-source';
import { SignalsPanel } from '../src/components/SignalsPanel';
import { capturePanels, devicePanels, panelsFor, type PanelDef } from '../src/components/pages';

const daq: SourceDescriptor = { id: 'daq-1', kind: 'daq-device', label: 'DAQ', provides: ['signals', 'series'] };

describe('panel acceptance', () => {
  it('matches declared data kinds and treats "any" as always shown', () => {
    expect(acceptsAny(['frames'], ['frames'])).toBe(true);
    expect(acceptsAny(['frames'], ['signals'])).toBe(false);
    expect(acceptsAny(['signals', 'series'], ['series'])).toBe(true);
    expect(acceptsAny('any', [])).toBe(true);
  });

  it('keeps every CAN panel for a CAN device and hides them for a DAQ source', () => {
    const can = canSourceDescriptor({ descriptor: null, target: 'ws://x' });
    expect(can.provides).toEqual(['frames']);
    expect(panelsFor(capturePanels, can.provides)).toEqual(capturePanels);
    expect(panelsFor(capturePanels, daq.provides)).toEqual([]);
    expect(panelsFor(devicePanels, daq.provides)).toEqual(devicePanels);
  });

  it('shows everything when no source is known', () => {
    expect(panelsFor(capturePanels, null)).toEqual(capturePanels);
  });

  it('selects a generic signal panel for a DAQ source only', () => {
    const generic: PanelDef = { id: 'signals', label: 'Signals', accepts: ['signals'], render: () => null };
    const all = [...capturePanels, generic];
    expect(panelsFor(all, daq.provides).map((p) => p.id)).toEqual(['signals']);
    expect(panelsFor(all, ['frames']).map((p) => p.id)).not.toContain('signals');
  });
});

describe('SignalBuffer and SignalsPanel', () => {
  it('drops samples for undeclared signals and non-finite values', () => {
    const buf = new SignalBuffer(daq, [{ id: 'v', name: 'Voltage', unit: 'V' }]);
    expect(buf.push({ signalId: 'nope', timestampNs: 1n, value: 1 })).toBe(false);
    expect(buf.push({ signalId: 'v', timestampNs: 1n, value: Number.NaN })).toBe(false);
    expect(buf.push({ signalId: 'v', timestampNs: 2n, value: 3.3 })).toBe(true);
    expect(buf.latest('v')?.value).toBe(3.3);
  });

  it('renders declared signals with units and updates on new samples, without product words', () => {
    const buf = new SignalBuffer(daq, [{ id: 'v', name: 'Voltage', unit: 'V' }]);
    render(<SignalsPanel source={buf} />);
    expect(screen.getByRole('row', { name: /Voltage/ })).toHaveTextContent('no data yet');
    act(() => {
      buf.push({ signalId: 'v', timestampNs: 5n, value: 12.5 });
    });
    expect(screen.getByRole('row', { name: /Voltage/ })).toHaveTextContent('12.5');
    expect(screen.getByRole('row', { name: /Voltage/ })).toHaveTextContent('V');
    act(() => buf.declare({ id: 'i', name: 'Current', unit: 'A' }));
    expect(screen.getByRole('row', { name: /Current/ })).toHaveTextContent('no data yet');
    expect(document.body.textContent).not.toMatch(/\bCAN\b|frame/i);
  });

  it('says so when a source has no signals', () => {
    render(<SignalsPanel source={new SignalBuffer(daq)} />);
    expect(screen.getByText(/has not declared any signals/)).toBeInTheDocument();
  });
});
