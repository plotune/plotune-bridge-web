import { MAX_DBC_BYTES } from './parse';

/**
 * Reads a chosen file as text, entirely in the browser. DBC files are often saved as Windows-1252 rather than UTF-8,
 * so a file that is not valid UTF-8 is read as Windows-1252 instead of showing replacement characters.
 */
export async function readDbcFile(file: Pick<File, 'size' | 'arrayBuffer'>): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  if (file.size > MAX_DBC_BYTES) return { ok: false, message: 'This file is larger than 5 MB, which is too big for a DBC file.' };
  try {
    const bytes = await file.arrayBuffer();
    try {
      return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
    } catch {
      return { ok: true, text: new TextDecoder('windows-1252').decode(bytes) };
    }
  } catch {
    return { ok: false, message: 'This file could not be read.' };
  }
}
