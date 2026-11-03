// Decoding the frames of an opened log with the databases linked to its channels. Only the signals asked for are decoded.
import { decodeSelected } from '../dbc/decode';
import type { DbcRegistry } from '../dbc/registry';
import type { SignalData } from '../analysis/math';
import { looksBoolean } from '../analysis/csv';
import type { TreeGroup } from '../components/SignalTree';
import type { CanLog } from './read';

/** The database source of an opened log. Each log has its own, so two logs never share channel links. */
export const logSource = (recordingId: string): string => `log:${recordingId}`;
const messageKey = (channel: number, extended: boolean | number, id: number): string => `${channel}:${extended ? 'x' : 's'}${id}`;

/** The messages that occur in the log, as `channel:s123`. */
export function presentMessages(log: CanLog): Set<string> {
  const out = new Set<string>();
  const f = log.frames;
  for (let i = 0; i < f.count; i += 1) out.add(messageKey(f.channel[i]!, f.extended[i]!, f.id[i]!));
  return out;
}

export const signalKey = (channel: number, message: string, signal: string): string => `${channel}:${message}.${signal}`;

/** The signals that can be decoded: those of the linked databases whose messages occur in the log, grouped by message. */
export function logCatalog(present: ReadonlySet<string>, registry: DbcRegistry, source: string): TreeGroup[] {
  const groups: TreeGroup[] = [];
  for (const a of registry.of(source)) {
    for (const m of a.dbc.messages) {
      if (!present.has(messageKey(a.channel, m.extended, m.id)) || m.signals.length === 0) continue;
      groups.push({ id: messageKey(a.channel, m.extended, m.id), title: m.name, subtitle: `CAN${a.channel}`, signals: m.signals.map((s) => ({ id: signalKey(a.channel, m.name, s.name), name: s.name, unit: s.unit })) });
    }
  }
  return groups;
}

/** Decodes the wanted signals (by `signalKey`) in one pass over the frames. */
export function decodeLogSignals(log: CanLog, registry: DbcRegistry, source: string, wanted: ReadonlySet<string>): SignalData[] {
  const byMessage = new Map<string, { message: import('../dbc/types').DbcMessage; channel: number; names: Set<string>; out: Map<string, { t: number[]; v: number[]; unit: string }> }>();
  for (const a of registry.of(source)) {
    for (const m of a.dbc.messages) {
      const names = new Set(m.signals.filter((s) => wanted.has(signalKey(a.channel, m.name, s.name))).map((s) => s.name));
      if (names.size === 0) continue;
      byMessage.set(messageKey(a.channel, m.extended, m.id), { message: m, channel: a.channel, names, out: new Map([...names].map((n) => [n, { t: [], v: [], unit: m.signals.find((s) => s.name === n)?.unit ?? '' }])) });
    }
  }
  const f = log.frames;
  for (let i = 0; i < f.count; i += 1) {
    if (f.rtr[i]) continue;
    const entry = byMessage.get(messageKey(f.channel[i]!, f.extended[i]!, f.id[i]!));
    if (!entry) continue;
    for (const d of decodeSelected(entry.message, f.data.subarray(i * 8, i * 8 + 8), entry.names)) {
      const o = entry.out.get(d.name)!;
      o.t.push(f.t[i]!);
      o.v.push(d.value);
    }
  }
  const several = log.channels.size > 1;
  const signals: SignalData[] = [];
  for (const entry of byMessage.values()) {
    for (const [name, o] of entry.out) {
      const v = Float64Array.from(o.v);
      signals.push({ key: signalKey(entry.channel, entry.message.name, name), label: several ? `${name} · CAN${entry.channel}` : name, unit: o.unit, decimals: 2, bool: looksBoolean(v, o.unit), t: Float64Array.from(o.t), v });
    }
  }
  return signals;
}
