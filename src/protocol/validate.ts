// Client-side validation before a frame is sent. The device still validates, but a malformed
// frame must not reach the wire and must fail with a contract error the workspace can explain.
import { ContractError } from './errors';
import { fdPayloadLength, MAX_DLC, MAX_FD_DLC, type TxFrame } from './types';

export interface TxFrameCapabilities {
  /** The connected device's CAN FD capability; undefined when it is not known yet. */
  canFd?: boolean;
}

export function validateTxFrame(frame: TxFrame, capabilities: TxFrameCapabilities = {}): void {
  const fd = frame.fd === true;
  const brs = frame.brs === true;
  const esi = frame.esi === true;

  if (!fd && (brs || esi)) {
    throw new ContractError('MALFORMED_REQUEST', 'brs/esi require fd=true.');
  }
  if (fd && frame.rtr) {
    throw new ContractError('INVALID_DATA', 'CAN FD frames cannot be remote frames.');
  }
  if (fd && capabilities.canFd === false) {
    throw new ContractError('UNSUPPORTED_FEATURE', 'The connected device does not advertise CAN FD.');
  }
  if (!Number.isSafeInteger(frame.dlc) || frame.dlc < 0) {
    throw new ContractError('INVALID_DLC', 'DLC must be a non-negative integer.');
  }

  if (fd) {
    if (frame.dlc > MAX_FD_DLC) {
      throw new ContractError('INVALID_DLC', `CAN FD DLC ${frame.dlc} is above 15.`);
    }
    const expected = fdPayloadLength(frame.dlc);
    if (frame.data.length !== expected) {
      throw new ContractError('INVALID_DLC', `CAN FD DLC ${frame.dlc} carries ${expected} payload bytes, not ${frame.data.length}.`);
    }
  } else {
    if (frame.dlc > MAX_DLC) {
      throw new ContractError('INVALID_DLC', `Classical CAN DLC ${frame.dlc} is above 8.`);
    }
    const expected = frame.rtr ? 0 : frame.dlc;
    if (frame.data.length !== expected) {
      throw new ContractError('INVALID_DLC', frame.rtr ? 'A remote frame carries no data.' : `DLC ${frame.dlc} carries ${expected} payload bytes, not ${frame.data.length}.`);
    }
  }
}
