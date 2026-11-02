import { describe, expect, it } from 'vitest';
import { CsvError, parseCsv, recordingFromCsv, recordingFromSeries } from '../src/analysis/csv';
import { visibleCsv } from '../src/plot/csv';
import { Series } from '../src/plot/series';

describe('parsing CSV', () => {
  it('reads quoted fields, doubled quotes and CRLF', () => {
    expect(parseCsv('a,"b,c","say ""hi"""\r\n1,2,3\r\n')).toEqual([['a', 'b,c', 'say "hi"'], ['1', '2', '3']]);
  });
});

describe('recordings from CSV', () => {
  it('opens a file with a time column and one column per signal, with units in the names', () => {
    const r = recordingFromCsv('time_s,Speed [km/h],Gear\n10,50,2\n10.5,55,2\n11,60,\n', 'Drive');
    expect(r.name).toBe('Drive');
    expect(r.duration).toBeCloseTo(1);
    const speed = Object.values(r.signals).find((s) => s.label === 'Speed')!;
    expect(speed.unit).toBe('km/h');
    expect(Array.from(speed.t)).toEqual([0, 0.5, 1]);
    expect(Array.from(speed.v)).toEqual([50, 55, 60]);
    // A blank cell is no sample, and a column that is only 0 and 1 without a unit is a two-state signal.
    const gear = Object.values(r.signals).find((s) => s.label === 'Gear')!;
    expect(gear.t).toHaveLength(2);
    expect(gear.bool).toBe(false);
  });

  it('reads times in milliseconds when the header says so', () => {
    const r = recordingFromCsv('time_ms,A\n0,1\n500,2\n', 'x');
    expect(r.duration).toBeCloseTo(0.5);
  });

  it('takes the Scope\'s own export back', () => {
    const s = new Series({ channel: 1, id: 0x100, extended: false, signal: 'Speed', messageName: 'Drive', unit: 'km/h' }, 100);
    [0, 0.1, 0.2].forEach((t, i) => s.push(t, 10 * (i + 1)));
    const flag = new Series({ channel: 1, id: 0x101, extended: false, signal: 'Flag', messageName: 'Drive', unit: '' }, 100);
    [0, 0.1, 0.2].forEach((t, i) => flag.push(t, i % 2));
    const r = recordingFromCsv(visibleCsv([s, flag], 0, 1), 'scope');
    const speed = r.signals['CAN1:Drive.Speed']!;
    expect(speed.unit).toBe('km/h');
    expect(Array.from(speed.v)).toEqual([10, 20, 30]);
    expect(r.signals['CAN1:Drive.Flag']!.bool).toBe(true);
    expect(r.duration).toBeCloseTo(0.2);
  });

  it('sorts samples that arrive out of order', () => {
    const r = recordingFromCsv('time_s,A\n2,3\n0,1\n1,2\n', 'x');
    expect(Array.from(Object.values(r.signals)[0]!.v)).toEqual([1, 2, 3]);
  });

  it('explains what is wrong with a file that cannot be used', () => {
    expect(() => recordingFromCsv('', 'x')).toThrow(CsvError);
    expect(() => recordingFromCsv('hello,world\n1,2\n', 'x')).toThrow(/first column must be the time/);
    expect(() => recordingFromCsv('time_s,A\nx,y\n', 'x')).toThrow(/No samples/);
    expect(() => recordingFromCsv(`time_s,${Array.from({ length: 70 }, (_, i) => `S${i}`).join(',')}\n${Array.from({ length: 71 }, (_, i) => i).join(',')}\n`, 'x')).toThrow(/more than 64 signals/);
  });
});

describe('recordings from the Scope', () => {
  it('copies a window and counts time from its start', () => {
    const s = new Series({ channel: 2, id: 5, extended: false, signal: 'V', messageName: 'Bat', unit: 'V' }, 100);
    [10, 11, 12, 13, 14].forEach((t, i) => s.push(t, i));
    const r = recordingFromSeries([s], 11, 13, 'w')!;
    const v = r.signals['CAN2:Bat.V']!;
    expect(Array.from(v.t)).toEqual([0, 1, 2]);
    expect(Array.from(v.v)).toEqual([1, 2, 3]);
    expect(r.source).toBe('scope');
  });
  it('has nothing to keep from an empty window', () => {
    const s = new Series({ channel: 1, id: 1, extended: false, signal: 'x', messageName: 'm', unit: '' }, 10);
    expect(recordingFromSeries([s], 0, 1, 'w')).toBeNull();
  });
});
