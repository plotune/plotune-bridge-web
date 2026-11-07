import { bytesToHex } from '../lib/bytes';
import type { CanFrame } from '../protocol/types';

export type RecordFormat = 'asc' | 'blf' | 'candump' | 'csv';

export interface FormatSpec {
  id: RecordFormat;
  label: string;
  /** Short code for the 76 px top-bar control; `label` is the full descriptive name (title/docs). */
  shortLabel: string;
  extension: string;
  mime: string;
  /** Whether the file can say that the device reported lost frames. */
  carriesDrops: boolean;
  /** Binary formats are built by their own writer (see blf.ts); `header` and `line` are not used. */
  binary?: boolean;
  /** `canFd` is true once the recording has seen a CAN FD frame; CSV upgrades its columns then. */
  header(startedAt: Date, canFd?: boolean): string;
  /** `time` is the device clock in seconds since the first recorded frame, as "s.uuuuuu". */
  line(frame: CanFrame, time: string, canFd?: boolean): string;
  /** Rewrites text already written before the first FD frame (CSV upgrades its header and rows). */
  upgradeFd?(text: string): string;
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
  shortLabel: 'ASC',
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
    if (frame.fd === true) {
      const brs = frame.brs === true;
      const esi = frame.esi === true;
      const flags = 0x1000 | (brs ? 0x2000 : 0) | (esi ? 0x4000 : 0);
      const data = hexBytes(frame.data);
      const length = String(frame.data.length).padStart(2);
      return `${time.padStart(11)} CANFD ${frame.channel} ${direction.padEnd(4)} ${idText(frame).padEnd(15)} ${brs ? 1 : 0} ${esi ? 1 : 0} ${frame.dlc.toString(16).toUpperCase()} ${length}${data ? ` ${data}` : ''} 0 0 ${flags.toString(16).toUpperCase()} 0 0 0 0 0\n`;
    }
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
  shortLabel: 'candump',
  extension: 'log',
  mime: 'text/plain',
  carriesDrops: false,
  header: () => '',
  line(frame, time) {
    const id = frame.id.toString(16).toUpperCase().padStart(frame.extended ? 8 : 3, '0');
    if (frame.fd === true) {
      const flags = (frame.brs ? 0x1 : 0) | (frame.esi ? 0x2 : 0);
      return `(${time}) can${frame.channel - 1} ${id}##${flags.toString(16).toUpperCase()}${bytesToHex(frame.data).toUpperCase()}\n`;
    }
    const payload = frame.rtr ? 'R' : bytesToHex(frame.data).toUpperCase();
    return `(${time}) can${frame.channel - 1} ${id}#${payload}\n`;
  },
  dropLine: () => '',
};

/** Vector binary log. The writer is in blf.ts. */
const blf: FormatSpec = {
  id: 'blf',
  label: 'BLF (Vector binary)',
  shortLabel: 'BLF',
  extension: 'blf',
  mime: 'application/octet-stream',
  carriesDrops: false,
  binary: true,
  header: () => '',
  line: () => '',
  dropLine: () => '',
};

const csv: FormatSpec = {
  id: 'csv',
  label: 'CSV (spreadsheet)',
  shortLabel: 'CSV',
  extension: 'csv',
  mime: 'text/csv',
  carriesDrops: false,
  header: (_startedAt, canFd = false) => `time_s,channel,id_hex,extended,direction,remote,dlc,data_hex${canFd ? ',fd,brs,esi' : ''}\r\n`,
  line(frame, time, canFd = false) {
    const base = `${time},${frame.channel},${frame.id.toString(16).toUpperCase()},${frame.extended ? 1 : 0},${frame.direction},${frame.rtr ? 1 : 0},${frame.dlc},${bytesToHex(frame.data).toUpperCase()}`;
    return canFd ? `${base},${frame.fd ? 1 : 0},${frame.brs ? 1 : 0},${frame.esi ? 1 : 0}\r\n` : `${base}\r\n`;
  },
  upgradeFd(text) {
    const [header, ...rows] = text.split('\r\n');
    return [`${header},fd,brs,esi`, ...rows.map((row) => (row === '' ? '' : `${row},0,0,0`))].join('\r\n');
  },
  dropLine: () => '',
};

export const FORMATS: readonly FormatSpec[] = [asc, blf, candump, csv];
export const formatSpec = (id: RecordFormat): FormatSpec => FORMATS.find((f) => f.id === id)!;
