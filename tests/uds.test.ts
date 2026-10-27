import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ISOTP, IsoTpLink } from '../src/diagnostics/isotp';
import { UdsClient, buildKeySend, buildReadDid, buildSeedRequest, buildSessionControl, buildTesterPresent, describePositive, type UdsResult } from '../src/diagnostics/uds';
import { EcuLoopback } from './helpers/fakes';
import { MockEcu, type EcuOptions } from './helpers/mockEcu';
import { settle } from './helpers/timers';

const rig = (ecuOptions: EcuOptions = {}) => {
  const ecu = new MockEcu(ecuOptions);
  const io = new EcuLoopback(ecu);
  const link = new IsoTpLink(io, { channel: 1, ...DEFAULT_ISOTP });
  link.start();
  return { ecu, io, link, uds: new UdsClient(link) };
};
const positive = (r: UdsResult) => {
  if (r.kind !== 'positive') throw new Error(`expected a positive answer, got NRC ${r.nrc.toString(16)}`);
  return r;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('generic UDS over ISO-TP', () => {
  it('starts a diagnostic session and reads the timing', async () => {
    const { uds } = rig();
    const r = positive(await settle(uds.request(buildSessionControl(3))));
    expect(describePositive(r)).toBe('Session 03 active · P2 50 ms · P2* 5000 ms');
  });

  it('answers tester present', async () => {
    const { uds } = rig();
    expect(describePositive(positive(await settle(uds.request(buildTesterPresent()))))).toBe('Tester present acknowledged');
  });

  it('reads one identifier as text, and several across a multi-frame answer', async () => {
    const { uds } = rig();
    expect(describePositive(positive(await settle(uds.request(buildReadDid([0xf192])))))).toBe('Data for F192: "0.1.0"');
    const many = positive(await settle(uds.request(buildReadDid([0xf190, 0xf191, 0xf192, 0xf193]))));
    expect(many.raw).toHaveLength(43);
  });

  it('explains negative answers with their names', async () => {
    const { uds } = rig();
    const unknown = await settle(uds.request(buildReadDid([0xdead])));
    expect(unknown).toMatchObject({ kind: 'negative', nrc: 0x31, name: 'requestOutOfRange' });
    expect(await settle(uds.request(Uint8Array.of(0x99)))).toMatchObject({ kind: 'negative', nrc: 0x11, name: 'serviceNotSupported' });
    expect(await settle(uds.request(Uint8Array.of(0x10, 0x09)))).toMatchObject({ kind: 'negative', nrc: 0x12 });
  });

  it('security access: the seed is shown and the user supplies the key', async () => {
    const { uds } = rig();
    expect(await settle(uds.request(buildKeySend(1, Uint8Array.of(0xb7, 0x91))))).toMatchObject({ kind: 'negative', nrc: 0x24 }); // key before seed
    expect(describePositive(positive(await settle(uds.request(buildSeedRequest(1)))))).toBe('Seed: 12 34');
    expect(await settle(uds.request(buildKeySend(1, Uint8Array.of(0, 0))))).toMatchObject({ kind: 'negative', nrc: 0x35, name: 'invalidKey' });
    await settle(uds.request(buildSeedRequest(1)));
    expect(describePositive(positive(await settle(uds.request(buildKeySend(1, Uint8Array.of(0xb7, 0x91))))))).toBe('Key accepted');
  });

  it('waits through "response pending" (NRC 78) and reports how many it saw', async () => {
    const { uds } = rig({ pendingService: 0x31 });
    const r = positive(await settle(uds.request(Uint8Array.of(0x31, 0x01, 0xff, 0x00))));
    expect(r.pendingResponses).toBe(1);
    expect(r.raw[0]).toBe(0x71);
  });

  it('ignores an answer that belongs to another service and keeps waiting for its own', async () => {
    const { uds, io } = rig();
    const pending = uds.request(buildTesterPresent());
    io.emit({ channel: 1, id: 0x708, extended: false, rtr: false, dlc: 8, data: Uint8Array.of(0x03, 0x7f, 0x22, 0x31, 0, 0, 0, 0), direction: 'rx' });
    expect(describePositive(positive(await settle(pending)))).toBe('Tester present acknowledged');
  });

  it('times out when nothing answers', async () => {
    const { link } = rig();
    const silent = new UdsClient(new IsoTpLink(new EcuLoopback(new MockEcu(), 2), { channel: 1, ...DEFAULT_ISOTP, rxId: 0x7ff }), { p2Ms: 200, p2StarMs: 500, maxPending: 3 });
    expect(link).toBeDefined();
    await expect(settle(silent.request(buildTesterPresent()))).rejects.toMatchObject({ code: 'timeout' });
  });
});
