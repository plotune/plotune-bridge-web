import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_XCP, XcpClient, XcpError } from '../src/diagnostics/xcp';
import { EcuLoopback } from './helpers/fakes';
import { MockEcu } from './helpers/mockEcu';
import { settle } from './helpers/timers';

const rig = (over = {}) => {
  const ecu = new MockEcu();
  const io = new EcuLoopback(ecu);
  return { ecu, io, xcp: new XcpClient(io, { channel: 1, ...DEFAULT_XCP, ...over }) };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('XCP on CAN', () => {
  it('connects and reads the transport parameters', async () => {
    const { xcp } = rig();
    const c = await settle(xcp.connect());
    expect(c).toEqual({ resources: 1, byteOrder: 'little', maxCto: 8, maxDto: 8, protocolVersion: 1, transportVersion: 1 });
    expect(xcp.connected).toEqual(c);
  });

  it('reads memory across several short uploads (20 bytes from 0x10)', async () => {
    const { xcp, io } = rig();
    await settle(xcp.connect());
    const data = await settle(xcp.readMemory(0x10, 20));
    expect(Array.from(data)).toEqual(Array.from({ length: 20 }, (_, i) => 0x10 + i));
    const reads = io.transmitted.filter((f) => f.data[0] === 0xf4);
    expect(reads.map((f) => f.data[1])).toEqual([7, 7, 6]);
    expect(Array.from(reads[0].data)).toEqual([0xf4, 7, 0, 0, 0x10, 0, 0, 0]); // little-endian address, extension 0
  });

  it('writes memory with SET_MTA and sized DOWNLOAD pieces', async () => {
    const { xcp, ecu, io } = rig();
    await settle(xcp.connect());
    await settle(xcp.writeMemory(0x40, Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)));
    expect(Array.from(ecu.memory.subarray(0x40, 0x4a))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(io.transmitted.filter((f) => f.data[0] === 0xf0).map((f) => f.data[1])).toEqual([6, 4]);
    expect(await settle(xcp.readMemory(0x40, 3))).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('reports status, upload from the MTA, and disconnects', async () => {
    const { xcp } = rig();
    await settle(xcp.connect());
    expect(await settle(xcp.getStatus())).toEqual({ sessionStatus: 0, resourceProtection: 0, sessionConfigId: 0 });
    await settle(xcp.setMta(0x20));
    expect(Array.from(await settle(xcp.upload(4)))).toEqual([0x20, 0x21, 0x22, 0x23]);
    await settle(xcp.disconnect());
    expect(xcp.connected).toBeNull();
  });

  it('turns target errors into plain explanations with the standard code name', async () => {
    const { xcp } = rig();
    await settle(xcp.connect());
    const error = await settle(xcp.readMemory(0xfe, 7)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XcpError);
    expect(error).toMatchObject({ code: 0x22 });
    expect((error as XcpError).message).toMatch(/ERR_OUT_OF_RANGE/);
  });

  it('refuses commands before connect, and the target refuses them when not connected', async () => {
    const { xcp } = rig();
    await expect(xcp.readMemory(0, 4)).rejects.toThrow('Connect first');
    await expect(settle(xcp.getStatus())).rejects.toMatchObject({ code: 0x00 });
  });

  it('keeps one command in flight at a time even when called concurrently', async () => {
    const { xcp, io } = rig();
    await settle(xcp.connect());
    const [a, b] = await settle(Promise.all([xcp.shortUpload(0, 2), xcp.shortUpload(8, 2)]));
    expect(Array.from(a)).toEqual([0, 1]);
    expect(Array.from(b)).toEqual([8, 9]);
    expect(io.transmitted.filter((f) => f.data[0] === 0xf4)).toHaveLength(2);
  });

  it('times out when no answer arrives', async () => {
    const { xcp } = rig({ responseId: 0x7ff, timeoutMs: 200 });
    await expect(settle(xcp.connect())).rejects.toThrow('No answer');
  });

  it('can pad commands to eight bytes', async () => {
    const { xcp, io } = rig({ padTo8: true });
    await settle(xcp.connect());
    expect(io.transmitted[0].dlc).toBe(8);
  });
});
