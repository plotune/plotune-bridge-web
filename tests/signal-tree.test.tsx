import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SignalTree, type TreeGroup } from '../src/components/SignalTree';

afterEach(cleanup);
// 300 messages of 10 signals each: more than 3,000 signals, the size of a large vehicle database.
const groups: TreeGroup[] = Array.from({ length: 300 }, (_, m) => ({ id: `m${m}`, title: `Msg_${m}`, subtitle: 'Bridge 1 · CAN1', signals: Array.from({ length: 10 }, (_, s) => ({ id: `m${m}.s${s}`, name: `Sig_${m}_${s}`, unit: 'V' })) }));

it('draws only the rows in view for thousands of signals, with the messages closed', () => {
  render(<SignalTree groups={groups} chosen={new Set()} onToggle={() => undefined} />);
  expect(screen.getByText(/3,000 signals in 300 messages/)).toBeVisible();
  expect(document.querySelectorAll('.bw-tree-rows > li').length).toBeLessThan(30);
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it('a search opens what it finds across messages, and choosing reports the signal', () => {
  const picked: string[] = [];
  render(<SignalTree groups={groups} chosen={new Set()} onToggle={(_g, s, on) => { if (on) picked.push(s.id); }} />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search signals' }), { target: { value: 'sig_42_7' } });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(picked).toEqual(['m42.s7']);
  // A message name finds all of its signals.
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search signals' }), { target: { value: 'msg_7' } });
  expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(5);
});

it('a message opens and closes on a click', () => {
  render(<SignalTree groups={groups} chosen={new Set()} onToggle={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: /Msg_0/ }));
  expect(screen.getAllByRole('checkbox')).toHaveLength(10);
  fireEvent.click(screen.getByRole('button', { name: /Msg_0/ }));
  expect(screen.queryByRole('checkbox')).toBeNull();
});
