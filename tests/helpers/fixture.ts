import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FixtureLine {
  direction: 'send' | 'recv';
  /** The message exactly as written in the fixture (raw JSON text, digits untouched). */
  messageText: string;
}

/** Lines look like {"direction":"recv","message":{...}}; the message is always the last key. */
export function readFixture(): FixtureLine[] {
  const text = readFileSync(join(process.cwd(), 'contract/examples/session-v0.1.0.ndjson'), 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const marker = '"message":';
      const at = line.indexOf(marker);
      return { direction: JSON.parse(line.slice(0, at) + '"x":0}').direction, messageText: line.slice(at + marker.length, -1) };
    });
}
