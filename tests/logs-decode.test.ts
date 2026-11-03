import { describe, expect, it } from 'vitest';
import { DbcRegistry } from '../src/dbc/registry';
import { decodeLogSignals, logCatalog, logSource, presentMessages, signalKey } from '../src/logs/decode';
import { parseAsc } from '../src/logs/read';

const DBC = 'BO_ 2024 Resp: 2 X\n SG_ Counter : 0|8@1+ (1,0) [0|255] "rpm" Y\n SG_ Level : 8|8@1+ (0.5,-10) [-10|117.5] "degC" Y\nBO_ 291 Other: 1 X\n SG_ Seq : 0|8@1+ (1,0) [0|255] "" Y\n';
const ASC = ['   0.000000 1  7E8             Rx   d 2 05 AA', '   0.100000 1  7E8             Rx   d 2 06 AA', '   0.150000 2  123             Rx   d 1 09', '   0.200000 2  7E8             Rx   d 2 07 AA'].join('\n');

describe('decoding a log with the databases linked to its channels', () => {
  it('lists only what the links and the log have in common, and decodes per channel', () => {
    const log = parseAsc(ASC);
    const registry = new DbcRegistry(null);
    const source = logSource('r1');
    // CAN1 knows Resp; CAN2 knows Other only, so CAN2's 7E8 frame stays raw.
    registry.assign(source, 1, 'a.dbc', DBC);
    registry.assign(source, 2, 'b.dbc', 'BO_ 291 Other: 1 X\n SG_ Seq : 0|8@1+ (1,0) [0|255] "" Y\n');
    const groups = logCatalog(presentMessages(log), registry, source);
    expect(groups.map((g) => `${g.subtitle} ${g.title}`)).toEqual(['CAN1 Resp', 'CAN2 Other']);
    const [counter, seq] = decodeLogSignals(log, registry, source, new Set([signalKey(1, 'Resp', 'Counter'), signalKey(2, 'Other', 'Seq')]));
    expect(Array.from(counter!.v)).toEqual([5, 6]);
    expect(counter!.label).toBe('Counter · CAN1');
    expect(Array.from(seq!.v)).toEqual([9]);
    expect(Array.from(seq!.t)).toEqual([0.15]);
  });
  it('keeps two sources apart: the same channel number of two devices has its own database', () => {
    const registry = new DbcRegistry(null);
    registry.assign('Bridge 1', 1, 'a.dbc', DBC);
    expect(registry.message('Bridge 1', 1, 2024, false)?.name).toBe('Resp');
    expect(registry.message('Bridge 2', 1, 2024, false)).toBeUndefined();
    registry.copy({ source: 'Bridge 1', channel: 1 }, { source: 'Bridge 2', channel: 1 });
    expect(registry.message('Bridge 2', 1, 2024, false)?.name).toBe('Resp');
    registry.removeSource('Bridge 1');
    expect(registry.message('Bridge 1', 1, 2024, false)).toBeUndefined();
    expect(registry.message('Bridge 2', 1, 2024, false)?.name).toBe('Resp');
  });
});
