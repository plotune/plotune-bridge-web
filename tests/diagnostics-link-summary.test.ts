import { expect, it } from 'vitest';
import { describeLink } from '../src/components/DiagnosticsPanels';
import { DEFAULT_DIAG } from '../src/diagnostics/settings';

it('summarises the link in one line, upper-cased, with the ID format only when extended', () => {
  expect(describeLink(DEFAULT_DIAG, 'CAN1')).toBe('CAN1 · requests 7E0 → answers 7E8 · calibration 600 → 601');
  expect(describeLink({ ...DEFAULT_DIAG, udsRequestId: '18da10f1', udsResponseId: '18daf110', extended: true }, 'CAN2')).toBe('CAN2 · requests 18DA10F1 → answers 18DAF110 · calibration 600 → 601 · 29-bit');
  expect(describeLink({ ...DEFAULT_DIAG, udsRequestId: ' ' }, 'CAN1')).toContain('requests ? →');
});
