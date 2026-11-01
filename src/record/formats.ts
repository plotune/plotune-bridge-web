import { bytesToHex } from '../lib/bytes';
import type { CanFrame } from '../protocol/types';

export type RecordFormat = 'asc' | 'candump' | 'csv';

export interface FormatSpec {
  id: RecordFormat;
  label: string;
  extension: string;
  mime: string;
  /** Whether the file can say that the device reported lost frames. */
  carriesDrops: boolean;
  header(startedAt: Date): string;
  /** `time` is the device clock in seconds since the first recorded frame, as "s.uuuuuu". */
  line(frame: CanFrame, time: string): string;
  dropLine(channel: number, count: number, time: string): string;
}

const hexBytes = (data: Uint8Array) => bytesToHex(data, ' ').toUpperCase();
const idText = (frame: CanFrame) => frame.id.toString(16).toUpperCase() + (frame.extended ? 'x' : '');

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Vector ASCII log. Timestamps are the device clock from the first recorded frame; Classic CAN only. */
const asc: FormatSpec = {
  id: 'asc',
  label: 'ASC (Vector text)',
  extension: 'asc',
  mime: 'text/plain',
  carriesDrops: true,
  header(d) {
    const hours = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
    const stamp = `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${pad(hours)}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ${d.getHours() < 12 ? 'am' : 'pm'} ${d.getFullYear()}`;
    return `date ${stamp}\nbase hex  timestamps absolute\ninternal events logged\n// Recorded by Plotune Bridge. Timestamps are the device clock in seconds from the first recorded frame.\n// version 9.0.0\n`;
  },
  line(frame, time) {
    const direction = frame.direction === 'rx' ? 'Rx' : 'Tx';
    const head = `${time.padStart(11)} ${frame.channel}  ${idText(frame).padEnd(15)} ${direction}   `;
    return frame.rtr ? `${head}r ${frame.dlc}\n` : `${head}d ${frame.dlc}${frame.dlc > 0 ? ` ${hexBytes(frame.data)}` : ''}\n`;
  },
  dropLine(channel, count, time) {
    return `// ${time} CAN ${channel}: the device reported ${count} lost ${count === 1 ? 'frame' : 'frames'} here (their exact position is not known)\n`;
  },
};

/** The `candump -l` format of SocketCAN utilities. Time is relative to the first frame; the device channel n becomes can(n-1). */
const candump: FormatSpec = {
  id: 'candump',
  label: 'candump log (.log)',
  extension: 'log',
  mime: 'text/plain',
  carriesDrops: false,
  header: () => '',
  line(frame, time) {
    const id = frame.id.toString(16).toUpperCase().padStart(frame.extended ? 8 : 3, '0');
    const payload = frame.rtr ? 'R' : bytesToHex(frame.data).toUpperCase();
    return `(${time}) can${frame.channel - 1} ${id}#${payload}\n`;
  },
  dropLine: () => '',
};

const csv: FormatSpec = {
  id: 'csv',
  label: 'CSV (spreadsheet)',
  extension: 'csv',
  mime: 'text/csv',
  carriesDrops: false,
  header: () => 'time_s,channel,id_hex,extended,direction,remote,dlc,data_hex\r\n',
  line(frame, time) {
    return `${time},${frame.channel},${frame.id.toString(16).toUpperCase()},${frame.extended ? 1 : 0},${frame.direction},${frame.rtr ? 1 : 0},${frame.dlc},${bytesToHex(frame.data).toUpperCase()}\r\n`;
  },
  dropLine: () => '',
};

export const FORMATS: readonly FormatSpec[] = [asc, candump, csv];
export const formatSpec = (id: RecordFormat): FormatSpec => FORMATS.find((f) => f.id === id)!;
