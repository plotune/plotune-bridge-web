import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SerialClient, validateSerialDescriptor, validateSerialRx } from '../src/device/serial';
import { FakeWebSocket } from './helpers/fakeWebSocket';

const descriptor = {
  contract_version: '0.1.0', session_id: 'session-1', device_id: 'serial-1', firmware: 'test', profile: 'dual',
  supported_modes: ['rs232', 'rs422', 'rs485'], supported_baud_rates: [9600, 19200, 38400, 57600, 115200, 1000000], rx_queue_capacity: 64,
  clock: { monotonic_ns: 1, wall_clock_ns: null, wall_clock_synced: false },
  channels: [1, 2].map((channel) => ({ channel, name: `Serial ${channel}`, config: null, streaming: false, rx_queue_depth: 0, rx_queue_capacity: 64 })),
};
const serialStatus = (channel: number) => ({ channel, name: `Serial ${channel}`, config: { mode: 'rs232', baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1, termination: false, bias: false }, streaming: false, rx_queue_depth: 0, rx_queue_capacity: 64 });
const serialStats = (channel: number) => ({ channel, rx_bytes_received: 0, rx_bytes_forwarded: 0, rx_bytes_dropped: 0, rx_overrun_bytes: 0, rx_queue_overflow_bytes: 0, tx_bytes_accepted: 0, tx_bytes_sent: 0, tx_bytes_failed: 0, tx_echo_dropped: 0, framing_errors: 0, parity_errors: 0, break_events: 0, rx_overrun_events: 0 });
const wireJson = (message: unknown) => JSON.stringify(message, (_key, value) => typeof value === 'bigint' ? String(value) : value).replace(/("(?:timestamp_ns|since_ns|monotonic_ns|wall_clock_ns)"\s*:)\s*"(\d+)"/g, '$1$2');
async function connected() {
  const connecting = SerialClient.connect('ws://serial.test', undefined);
  await Promise.resolve();
  const ws = FakeWebSocket.instances.at(-1)!;
  ws.open();
  await Promise.resolve();
  const hello = JSON.parse(ws.sent[0]) as { id: number };
  ws.receive(JSON.stringify({ type: 'response', id: hello.id, ok: true, result: descriptor }));
  const { client } = await connecting;
  return { client, ws };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  FakeWebSocket.throwOnConstruct = null;
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Serial validators', () => {
  it('accepts and sorts the complete v0.1 descriptor and preserves uint64 timestamps as bigint', () => {
    const result = validateSerialDescriptor({ ...descriptor, channels: [...descriptor.channels].reverse(), clock: { ...descriptor.clock, monotonic_ns: 9007199254740993n } });
    expect(result.channels.map((channel) => channel.channel)).toEqual([1, 2]);
    expect(result.clock.monotonic_ns).toBe(9007199254740993n);
  });

  it.each([
    ['unsupported version', { ...descriptor, contract_version: '0.2.0' }],
    ['missing required baud capability', { ...descriptor, supported_baud_rates: [9600] }],
    ['duplicate channel', { ...descriptor, channels: [descriptor.channels[0], descriptor.channels[0]] }],
    ['invalid timestamp type', { ...descriptor, clock: { ...descriptor.clock, monotonic_ns: 1 } }],
  ])('rejects a descriptor with %s', (_name, input) => {
    expect(() => validateSerialDescriptor(input)).toThrow(/Serial protocol/);
  });

  it('accepts data and loss-only RX events while retaining exact byte strings', () => {
    expect(validateSerialRx({ seq: 1, channel: 1, dropped: 0, timestamp_ns: 9007199254740993n, direction: 'rx', data: '00ff' })).toMatchObject({ data: '00ff', timestamp_ns: 9007199254740993n });
    expect(validateSerialRx({ seq: 2, channel: 2, dropped: 4, timestamp_ns: 8n, direction: 'rx', data: '' }).dropped).toBe(4);
  });

  it.each([
    ['odd-length hex', { seq: 1, channel: 1, dropped: 0, timestamp_ns: 1n, direction: 'rx', data: 'a' }],
    ['non-hex data', { seq: 1, channel: 1, dropped: 0, timestamp_ns: 1n, direction: 'rx', data: 'gg' }],
    ['empty data without loss', { seq: 1, channel: 1, dropped: 0, timestamp_ns: 1n, direction: 'rx', data: '' }],
    ['unknown direction', { seq: 1, channel: 1, dropped: 0, timestamp_ns: 1n, direction: 'both', data: '00' }],
  ])('rejects RX event with %s', (_name, input) => {
    expect(() => validateSerialRx(input)).toThrow(/Serial protocol/);
  });
});

describe('SerialClient request handling', () => {
  it.each([
    ['CHANNEL_BUSY', (client: SerialClient) => client.configureChannel(1, { mode: 'rs232', baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1, termination: false, bias: false }), 'configure_channel'],
    ['TX_QUEUE_FULL', (client: SerialClient) => client.transmit(1, '00'), 'transmit'],
    ['UNKNOWN_CHANNEL', (client: SerialClient) => client.configureChannel(3, { mode: 'rs232', baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1, termination: false, bias: false }), 'configure_channel'],
  ])('propagates %s from %s without reporting success or closing the session', async (code, perform, expectedOp) => {
    const { client, ws } = await connected();
    const statusEvents: unknown[] = [];
    client.on({ status: (status) => statusEvents.push(status) });
    const result = perform(client);
    const request = JSON.parse(ws.sent.at(-1)!) as { id: number; op: string };
    expect(request.op).toBe(expectedOp);
    ws.receive(JSON.stringify({ type: 'response', id: request.id, ok: false, error: { code, message: 'fixture error' } }));
    await expect(result).rejects.toThrow(`${code}: fixture error`);
    expect(statusEvents).toEqual([]);
    expect(client.isConnected).toBe(true);
    expect(ws.sent).toHaveLength(2); // hello plus the rejected operation; no follow-up or retry
    client.close();
  });

  it('surfaces NOT_CONNECTED when hello is rejected before a session is established', async () => {
    const connecting = SerialClient.connect('ws://serial.test', undefined);
    await Promise.resolve();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    await Promise.resolve();
    const hello = JSON.parse(ws.sent[0]) as { id: number; op: string };
    expect(hello.op).toBe('hello');
    ws.receive(JSON.stringify({ type: 'response', id: hello.id, ok: false, error: { code: 'NOT_CONNECTED', message: 'hello required' } }));
    await expect(connecting).rejects.toThrow('NOT_CONNECTED: hello required');
    expect(ws.sent).toHaveLength(1); // no operation is issued before hello succeeds
  });

  it('expires an unanswered request at REQUEST_TIMEOUT_MS (5000 ms)', async () => {
    vi.useFakeTimers();
    const { client, ws } = await connected();
    const result = client.transmit(1, '00');
    const request = JSON.parse(ws.sent.at(-1)!) as { id: number };
    const rejected = expect(result).rejects.toThrow('Serial request transmit timed out');
    await vi.advanceTimersByTimeAsync(4999);
    expect(ws.closeCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    // A late reply to an expired request is ignored, not treated as a protocol violation.
    ws.receive(JSON.stringify({ type: 'response', id: request.id, ok: false, error: { code: 'TIMEOUT', message: 'late' } }));
    expect(ws.closeCalls).toHaveLength(0);
    client.close();
  });

  it('accepts a valid channel_status event and validates its advertised configuration', async () => {
    const { client, ws } = await connected();
    const statuses: unknown[] = [];
    client.on({ status: (status) => statuses.push(status) });
    ws.receive(wireJson({ type: 'event', event: 'channel_status', data: serialStatus(1) }));
    expect(statuses).toEqual([serialStatus(1)]);
    expect(client.isConnected).toBe(true);
    client.close();
  });

  it('closes on malformed channel_status events', async () => {
    const { client, ws } = await connected();
    const statuses: unknown[] = [];
    const closes: unknown[] = [];
    client.on({ status: (status) => statuses.push(status), close: (info) => closes.push(info) });
    ws.receive(wireJson({ type: 'event', event: 'channel_status', data: serialStatus(3) }));
    expect(statuses).toEqual([]);
    expect(closes[0]).toMatchObject({ code: 4000, initiatedBy: 'local' });
    client.close();
  });

  it('accepts a valid get_statistics result and preserves its uint64 timestamp', async () => {
    const { client, ws } = await connected();
    const pending = client.statistics();
    const request = JSON.parse(ws.sent.at(-1)!) as { id: number; op: string };
    expect(request.op).toBe('get_statistics');
    const response = { timestamp_ns: 9007199254740993n, since_ns: 9007199254740000n, statistics: [serialStats(1), serialStats(2)] };
    ws.receive(wireJson({ type: 'response', id: request.id, ok: true, result: response }));
    const result = await pending;
    expect(result.timestamp_ns).toBe(9007199254740993n);
    expect(result.statistics.map((item) => item.channel)).toEqual([1, 2]);
    client.close();
  });

  it('closes when get_statistics returns an incomplete channel set', async () => {
    const { client, ws } = await connected();
    const closes: unknown[] = [];
    client.on({ close: (info) => closes.push(info) });
    const pending = client.statistics();
    const request = JSON.parse(ws.sent.at(-1)!) as { id: number };
    ws.receive(wireJson({ type: 'response', id: request.id, ok: true, result: { timestamp_ns: 5n, since_ns: 1n, statistics: [serialStats(1)] } }));
    await expect(pending).rejects.toThrow('Device disconnected');
    expect(closes[0]).toMatchObject({ code: 4000, initiatedBy: 'local' });
    client.close();
  });

  it('closes if configure_channel returns a status for a different channel', async () => {
    const { client, ws } = await connected();
    const closes: unknown[] = [];
    client.on({ close: (info) => closes.push(info) });
    const pending = client.configureChannel(1, { mode: 'rs232', baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1, termination: false, bias: false });
    const request = JSON.parse(ws.sent.at(-1)!) as { id: number };
    ws.receive(wireJson({ type: 'response', id: request.id, ok: true, result: { channel: serialStatus(2) } }));
    await expect(pending).rejects.toThrow('Device disconnected');
    expect(closes[0]).toMatchObject({ code: 4000, initiatedBy: 'local' });
    client.close();
  });

  it('closes if transmit reports a byte count different from the request', async () => {
    const { client, ws } = await connected();
    const closes: unknown[] = [];
    client.on({ close: (info) => closes.push(info) });
    const pending = client.transmit(1, '00');
    const request = JSON.parse(ws.sent.at(-1)!) as { id: number };
    ws.receive(wireJson({ type: 'response', id: request.id, ok: true, result: { accepted: true, bytes_accepted: 2 } }));
    await expect(pending).rejects.toThrow('Device disconnected');
    expect(closes[0]).toMatchObject({ code: 4000, initiatedBy: 'local' });
    client.close();
  });
});
