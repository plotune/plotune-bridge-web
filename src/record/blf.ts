import type { CanFrame } from '../protocol/types';

// Vector Binary Logging Format (BLF), Classic CAN only. The layout follows the structures python-can reads and writes:
// a 144-byte file header ("LOGG"), then log containers ("LOBJ", type 10) holding zlib-compressed CAN message objects (type 1).

const FILE_HEADER_SIZE = 144;
const OBJ_BASE = 16; // signature, header size, version, object size, object type
const OBJ_V1 = 16; // flags, client index, object version, timestamp
const CONTAINER_HEADER = 16; // method, uncompressed size
const CAN_MESSAGE = 1;
const LOG_CONTAINER = 10;
const ZLIB_DEFLATE = 2;
const TIME_ONE_NANS = 2;
const CAN_MSG_EXT = 0x8000_0000;
const REMOTE_FLAG = 0x80;
const DIR_TX = 0x01;
const MAX_CONTAINER = 128 * 1024;

export const BLF_OBJECT_SIZE = OBJ_BASE + OBJ_V1 + 16;

/** One CAN message object (48 bytes). `relativeNs` is the time since the first recorded frame. */
export function blfCanMessage(frame: CanFrame, relativeNs: bigint): Uint8Array {
  const out = new Uint8Array(BLF_OBJECT_SIZE);
  const v = new DataView(out.buffer);
  out.set([0x4c, 0x4f, 0x42, 0x4a], 0); // "LOBJ"
  v.setUint16(4, OBJ_BASE + OBJ_V1, true);
  v.setUint16(6, 1, true);
  v.setUint32(8, BLF_OBJECT_SIZE, true);
  v.setUint32(12, CAN_MESSAGE, true);
  v.setUint32(16, TIME_ONE_NANS, true);
  v.setBigUint64(24, relativeNs < 0n ? 0n : relativeNs, true);
  v.setUint16(32, frame.channel, true);
  v.setUint8(34, (frame.rtr ? REMOTE_FLAG : 0) | (frame.direction === 'tx' ? DIR_TX : 0));
  v.setUint8(35, frame.dlc);
  v.setUint32(36, (frame.id | (frame.extended ? CAN_MSG_EXT : 0)) >>> 0, true);
  if (!frame.rtr) out.set(frame.data.subarray(0, 8), 40);
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // "deflate" in CompressionStream is the zlib format (RFC 1950), which is what BLF containers use.
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function systemTime(d: Date): number[] {
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDay(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()];
}

/** Packs the objects into compressed containers and writes the file. Object padding follows python-can (obj_size % 4 zero bytes). */
export async function buildBlfBytes(objects: readonly Uint8Array[], startedAt: Date, stoppedAt: Date): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let uncompressedTotal = FILE_HEADER_SIZE;
  let size = FILE_HEADER_SIZE;
  let start = 0;
  while (start < objects.length) {
    let end = start;
    let bytes = 0;
    while (end < objects.length && (bytes === 0 || bytes + objects[end].length <= MAX_CONTAINER)) bytes += objects[end++].length;
    const raw = new Uint8Array(bytes);
    let at = 0;
    for (let i = start; i < end; i += 1) {
      raw.set(objects[i], at);
      at += objects[i].length;
    }
    const packed = await deflate(raw);
    const objSize = OBJ_BASE + CONTAINER_HEADER + packed.length;
    const padding = objSize % 4;
    const container = new Uint8Array(objSize + padding);
    const v = new DataView(container.buffer);
    container.set([0x4c, 0x4f, 0x42, 0x4a], 0);
    v.setUint16(4, OBJ_BASE, true);
    v.setUint16(6, 1, true);
    v.setUint32(8, objSize, true);
    v.setUint32(12, LOG_CONTAINER, true);
    v.setUint16(16, ZLIB_DEFLATE, true);
    v.setUint32(24, raw.length, true);
    container.set(packed, OBJ_BASE + CONTAINER_HEADER);
    parts.push(container);
    size += container.length;
    uncompressedTotal += OBJ_BASE + CONTAINER_HEADER + raw.length;
    start = end;
  }
  const header = new Uint8Array(FILE_HEADER_SIZE);
  const h = new DataView(header.buffer);
  header.set([0x4c, 0x4f, 0x47, 0x47], 0); // "LOGG"
  h.setUint32(4, FILE_HEADER_SIZE, true);
  header.set([5, 0, 0, 0, 2, 6, 8, 1], 8); // application id, versions (the values python-can writes)
  h.setBigUint64(16, BigInt(size), true);
  h.setBigUint64(24, BigInt(uncompressedTotal), true);
  h.setUint32(32, objects.length, true);
  h.setUint32(36, 0, true);
  systemTime(startedAt).forEach((n, i) => h.setUint16(40 + i * 2, n, true));
  systemTime(stoppedAt).forEach((n, i) => h.setUint16(56 + i * 2, n, true));
  const file = new Uint8Array(size);
  file.set(header, 0);
  let at = FILE_HEADER_SIZE;
  for (const part of parts) {
    file.set(part, at);
    at += part.length;
  }
  return file;
}

export async function buildBlf(objects: readonly Uint8Array[], startedAt: Date, stoppedAt: Date): Promise<Blob> {
  return new Blob([(await buildBlfBytes(objects, startedAt, stoppedAt)) as BlobPart], { type: 'application/octet-stream' });
}
