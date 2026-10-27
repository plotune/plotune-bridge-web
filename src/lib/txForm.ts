import { MAX_DLC, MAX_EXTENDED_ID, MAX_STANDARD_ID, type TxFrame } from '../protocol/types';
import { parseHexBytes, parseHexNumber } from './bytes';

export interface TxForm {
  channel: number;
  id: string;
  extended: boolean;
  rtr: boolean;
  /** Only used for remote requests; a data frame's length is the number of data bytes. */
  dlc: string;
  data: string;
}

export interface TxValidation {
  frame: TxFrame | null;
  errors: { id?: string; data?: string; dlc?: string };
}

export function validateTx(form: TxForm): TxValidation {
  const errors: TxValidation['errors'] = {};
  const id = parseHexNumber(form.id);
  const limit = form.extended ? MAX_EXTENDED_ID : MAX_STANDARD_ID;
  if (!form.id.trim()) errors.id = 'Enter an ID in hex.';
  else if (id === null) errors.id = 'Use hex digits only, for example 123.';
  else if (id > limit) errors.id = form.extended ? 'Extended IDs go up to 1FFFFFFF.' : 'Standard IDs go up to 7FF. Choose extended for larger IDs.';

  let data: Uint8Array = new Uint8Array();
  let dlc = 0;
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
  if (Object.keys(errors).length || id === null) return { frame: null, errors };
  return { frame: { channel: form.channel, id, extended: form.extended, rtr: form.rtr, dlc, data }, errors };
}
