import { describe, expect, it } from 'vitest';
import { decodeBatch, decodeDescriptor, decodeStatisticsResult } from '../src/protocol/decode';
import { ProtocolViolation } from '../src/protocol/errors';
import { parseWire } from '../src/protocol/wire';
import { formatRelativeNs } from '../src/lib/bytes';
import { readFixture } from './helpers/fixture';
import { assertSchemaValid } from './helpers/schema';

describe('nanosecond fields are parsed as 64-bit integers', () => {
  it('keeps every digit of values above 2^53 where JSON.parse would round', () => {
    const text = '{"clock":{"monotonic_ns":1152921504606846977,"wall_clock_ns":1700000000000000001,"wall_clock_synced":true}}';
    const lossy = JSON.parse(text).clock.wall_clock_ns;
    expect(BigInt(lossy)).not.toBe(1700000000000000001n); // the problem this solves
    const parsed = parseWire(text) as { clock: { monotonic_ns: bigint; wall_clock_ns: bigint } };
    expect(parsed.clock.monotonic_ns).toBe(1152921504606846977n);
    expect(parsed.clock.wall_clock_ns).toBe(1700000000000000001n);
    expect(parsed.clock.wall_clock_ns - parsed.clock.monotonic_ns).toBe(547078495393153024n);
  });

  it('handles all four fields, whitespace, nesting and the uint64 maximum', () => {
    const text = '{"a":[{"timestamp_ns" : 18446744073709551615}],"b":{"since_ns":0,"c":{"monotonic_ns":9007199254740993}},"wall_clock_ns":123}';
    const p = parseWire(text) as { a: { timestamp_ns: bigint }[]; b: { since_ns: bigint; c: { monotonic_ns: bigint } }; wall_clock_ns: bigint };
    expect(p.a[0].timestamp_ns).toBe(18446744073709551615n);
    expect(p.b.since_ns).toBe(0n);
    expect(p.b.c.monotonic_ns).toBe(9007199254740993n);
    expect(p.wall_clock_ns).toBe(123n);
  });

  it('leaves null wall-clock values and ordinary numbers as they are', () => {
    const p = parseWire('{"wall_clock_ns":null,"id":2047,"dlc":8,"seq":5}') as Record<string, unknown>;
    expect(p).toEqual({ wall_clock_ns: null, id: 2047, dlc: 8, seq: 5 });
  });

  it('rejects values beyond unsigned 64 bits', () => {
    expect(() => parseWire('{"timestamp_ns":18446744073709551616}')).toThrow(ProtocolViolation);
  });

  it('does not touch text that merely looks like a field inside a string', () => {
    const text = '{"type":"response","error":{"message":"saw \\"timestamp_ns\\": 5 in the log"}}';
    const p = parseWire(text) as { error: { message: string } };
    expect(p.error.message).toBe('saw "timestamp_ns": 5 in the log');
  });

  it.each(['not json', '[1,2]', '5', 'null', '{"a":'])('rejects %s', (text) => {
    expect(() => parseWire(text)).toThrow(ProtocolViolation);
  });

  it('formats relative time from BigInt without losing microseconds', () => {
    const origin = 1152921504606846977n;
    expect(formatRelativeNs(origin + 1_234_567_890n, origin)).toBe('1.234567');
    expect(formatRelativeNs(origin, origin)).toBe('0.000000');
    expect(formatRelativeNs(origin - 2_000_001n, origin)).toBe('-0.002000');
  });
});

describe('conformance fixture from plotune-nexus (contract/examples)', () => {
  const lines = readFixture();

  it('every message in the fixture is valid against the vendored JSON Schema, except the deliberate invalid request', () => {
    const invalid = lines.filter((l) => {
      try {
        assertSchemaValid(l.messageText);
        return false;
      } catch {
        return true;
      }
    });
    // The fixture demonstrates one rejected request (id 0x800 as a standard id); it is invalid on purpose.
    expect(invalid.map((l) => l.direction)).toEqual(['send']);
    expect(invalid[0].messageText).toContain('"id":2048');
  });

  it('decodes every device message and keeps timestamp digits identical to the fixture text', () => {
    let frames = 0;
    for (const line of lines.filter((l) => l.direction === 'recv')) {
      const message = parseWire(line.messageText) as { type: string; event?: string; ok?: boolean; result?: Record<string, unknown>; data?: unknown };
      if (message.type === 'event' && message.event === 'frames') {
        const batch = decodeBatch(message.data);
        const raw = [...line.messageText.matchAll(/"timestamp_ns":(\d+)/g)].map((m) => m[1]);
        expect(batch.frames.map((f) => f.timestampNs.toString())).toEqual(raw);
        frames += batch.frames.length;
      } else if (message.type === 'response' && message.ok && message.result?.contract_version) {
        const descriptor = decodeDescriptor(message.result);
        expect(descriptor.contractVersion).toBe('0.1.0');
        expect(descriptor.canFd).toBe(false);
        expect(descriptor.clock.monotonicNs.toString()).toBe(line.messageText.match(/"monotonic_ns":(\d+)/)![1]);
        expect(descriptor.clock.wallClockNs!.toString()).toBe(line.messageText.match(/"wall_clock_ns":(\d+)/)![1]);
      } else if (message.type === 'response' && message.ok && message.result?.statistics) {
        const stats = decodeStatisticsResult(message.result);
        expect(stats.statistics.length).toBeGreaterThan(0);
      }
    }
    expect(frames).toBeGreaterThan(10);
  });

  it('contains device timestamps and wall-clock values above 2^53, which is the case this codec exists for', () => {
    const digits = lines.flatMap((l) => [...l.messageText.matchAll(/"(?:wall_clock_ns|timestamp_ns|monotonic_ns)":(\d+)/g)].map((m) => BigInt(m[1])));
    expect(digits.some((v) => v > 9007199254740992n)).toBe(true);
  });
});
