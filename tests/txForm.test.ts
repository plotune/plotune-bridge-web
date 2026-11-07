import { describe, expect, it } from 'vitest';
import { validateTx, type TxForm } from '../src/lib/txForm';

const form = (over: Partial<TxForm> = {}): TxForm => ({
  channel: 1, id: '123', extended: false, rtr: false, dlc: '0', data: '11 22 33 44', fd: false, brs: false, esi: false, ...over,
});
const bytes = (n: number) => Array.from({ length: n }, (_, i) => (i & 0xff).toString(16).padStart(2, '0')).join(' ');

describe('Classical CAN form (unchanged)', () => {
  it('builds a data frame with the byte count as its DLC', () => {
    const { frame, errors } = validateTx(form());
    expect(errors).toEqual({});
    expect(frame).toEqual({ channel: 1, id: 0x123, extended: false, rtr: false, dlc: 4, data: Uint8Array.of(0x11, 0x22, 0x33, 0x44) });
  });

  it('keeps the 8-byte limit and its existing message', () => {
    expect(validateTx(form({ data: bytes(9) })).errors.data).toBe('A CAN frame carries at most 8 bytes.');
  });

  it('builds a remote request with a requested length of 0 to 8', () => {
    expect(validateTx(form({ rtr: true, dlc: '8', data: '' })).frame).toMatchObject({ rtr: true, dlc: 8 });
    expect(validateTx(form({ rtr: true, dlc: '9', data: '' })).errors.dlc).toBe('Length must be 0 to 8.');
  });

  it('rejects BRS or ESI on a Classical frame', () => {
    expect(validateTx(form({ brs: true })).errors.fd).toBe('BRS and ESI require CAN FD.');
    expect(validateTx(form({ esi: true })).errors.fd).toBe('BRS and ESI require CAN FD.');
  });

  it('stays Classical when the device also supports CAN FD', () => {
    const { frame } = validateTx(form(), { canFd: true });
    expect(frame).not.toHaveProperty('fd');
    expect(frame).not.toHaveProperty('brs');
    expect(frame).not.toHaveProperty('esi');
  });
});

describe('CAN FD form', () => {
  it.each([[0, 0], [8, 8], [12, 9], [16, 10], [20, 11], [24, 12], [32, 13], [48, 14], [64, 15]])(
    'maps %i payload bytes to DLC %i', (length, dlc) => {
      const { frame, errors } = validateTx(form({ fd: true, data: bytes(length) }), { canFd: true });
      expect(errors).toEqual({});
      expect(frame).toMatchObject({ fd: true, brs: false, esi: false, dlc });
      expect(frame?.data).toEqual(Uint8Array.from({ length }, (_, i) => i & 0xff));
    });

  it('carries BRS and ESI toggles', () => {
    const { frame } = validateTx(form({ fd: true, brs: true, esi: true, data: bytes(12) }), { canFd: true });
    expect(frame).toMatchObject({ fd: true, brs: true, esi: true, dlc: 9 });
  });

  it('rejects lengths that are not valid FD payload lengths', () => {
    for (const n of [9, 10, 11, 13, 17, 63, 65]) {
      expect(validateTx(form({ fd: true, data: bytes(n) }), { canFd: true }).errors.data).toBe('A CAN FD frame carries 0-8, 12, 16, 20, 24, 32, 48 or 64 bytes.');
    }
  });

  it('rejects FD when the device does not advertise it', () => {
    expect(validateTx(form({ fd: true, data: bytes(12) }), { canFd: false }).errors.fd).toBe('This device supports Classical CAN only.');
  });

  it('rejects an FD remote request', () => {
    expect(validateTx(form({ fd: true, rtr: true, data: bytes(12) }), { canFd: true }).errors.fd).toBe('CAN FD frames cannot be remote requests.');
  });
});
