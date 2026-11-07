import { fdDlcForPayload, MAX_DLC, MAX_EXTENDED_ID, MAX_STANDARD_ID, type TxFrame } from '../protocol/types';
import { parseHexBytes, parseHexNumber } from './bytes';

export interface TxForm {
  channel: number;
  id: string;
  extended: boolean;
  rtr: boolean;
  /** Only used for remote requests; a data frame's length is the number of data bytes. */
  dlc: string;
  data: string;
  fd: boolean;
  brs: boolean;
  esi: boolean;
}

export interface TxValidation {
  frame: TxFrame | null;
  errors: { id?: string; data?: string; dlc?: string; fd?: string };
}

export interface TxFormOptions {
  /** The connected device's CAN FD capability. FD controls are unavailable when this is not true. */
  canFd?: boolean;
}

export function validateTx(form: TxForm, options: TxFormOptions = {}): TxValidation {
  const errors: TxValidation['errors'] = {};
  const id = parseHexNumber(form.id);
  const limit = form.extended ? MAX_EXTENDED_ID : MAX_STANDARD_ID;
  if (!form.id.trim()) errors.id = 'Enter an ID in hex.';
  else if (id === null) errors.id = 'Use hex digits only, for example 123.';
  else if (id > limit) errors.id = form.extended ? 'Extended IDs go up to 1FFFFFFF.' : 'Standard IDs go up to 7FF. Choose extended for larger IDs.';

  let data: Uint8Array = new Uint8Array();
  let dlc = 0;
  if (form.fd) {
    if (!options.canFd) errors.fd = 'This device supports Classical CAN only.';
    if (form.rtr) errors.fd = 'CAN FD frames cannot be remote requests.';
    const bytes = parseHexBytes(form.data);
    if (bytes === null) {
      errors.data = 'Use pairs of hex digits, for example 11 22 33.';
    } else {
      const fdDlc = fdDlcForPayload(bytes.length);
      if (fdDlc === null) errors.data = 'A CAN FD frame carries 0-8, 12, 16, 20, 24, 32, 48 or 64 bytes.';
      else {
        data = bytes;
        dlc = fdDlc;
      }
    }
  } else {
    if (form.brs || form.esi) errors.fd = 'BRS and ESI require CAN FD.';
    if (form.rtr) {
      const n = Number(form.dlc);
      if (!/^\d+$/.test(form.dlc.trim()) || n > MAX_DLC) errors.dlc = 'Length must be 0 to 8.';
      else dlc = n;
    } else {
      const bytes = parseHexBytes(form.data);
      if (bytes === null) errors.data = 'Use pairs of hex digits, for example 11 22 33.';
      else if (bytes.length > MAX_DLC) errors.data = 'A CAN frame carries at most 8 bytes.';
      else {
        data = bytes;
        dlc = bytes.length;
      }
    }
  }
  if (Object.keys(errors).length || id === null) return { frame: null, errors };
  return {
    frame: form.fd
      ? { channel: form.channel, id, extended: form.extended, rtr: false, fd: true, brs: form.brs, esi: form.esi, dlc, data }
      : { channel: form.channel, id, extended: form.extended, rtr: form.rtr, dlc, data },
    errors,
  };
}
