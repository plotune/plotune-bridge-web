import type { Series } from './series';

/** CSV field: quoted when it holds a comma, quote or line break, so a message or unit name cannot break the file. */
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The points inside [t0, t1] of every series, one row per sample, on the device clock (seconds since its first frame). */
export function visibleCsv(series: readonly Series[], t0: number, t1: number): string {
  const lines = ['time_s,channel,message,signal,value,unit'];
  for (const s of series) {
    for (let i = s.lowerBound(t0); i < s.length && s.timeAt(i) <= t1; i += 1) {
      lines.push([s.timeAt(i).toFixed(9), `CAN${s.key.channel}`, field(s.key.messageName), field(s.key.signal), String(s.valueAt(i)), field(s.key.unit)].join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}
