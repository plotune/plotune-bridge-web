// Generic UDS (ISO 14229-1) request/response tooling over the ISO-TP link. It sends what the user asks for and
// decodes what comes back. It holds no OEM-specific seed-key algorithms, flashing procedures or security logic
// (BR-CAN-PRO-003): a seed is shown, and the user supplies the key they computed themselves (BR-CAN-PRO-004).
import { IsoTpError, type IsoTpLink } from './isotp';

export const SERVICE_NAMES: Record<number, string> = {
  0x10: 'DiagnosticSessionControl',
  0x11: 'ECUReset',
  0x14: 'ClearDiagnosticInformation',
  0x19: 'ReadDTCInformation',
  0x22: 'ReadDataByIdentifier',
  0x23: 'ReadMemoryByAddress',
  0x27: 'SecurityAccess',
  0x28: 'CommunicationControl',
  0x2e: 'WriteDataByIdentifier',
  0x2f: 'InputOutputControlByIdentifier',
  0x31: 'RoutineControl',
  0x34: 'RequestDownload',
  0x35: 'RequestUpload',
  0x36: 'TransferData',
  0x37: 'RequestTransferExit',
  0x3e: 'TesterPresent',
  0x85: 'ControlDTCSetting',
};

export const NRC_NAMES: Record<number, string> = {
  0x10: 'generalReject',
  0x11: 'serviceNotSupported',
  0x12: 'subFunctionNotSupported',
  0x13: 'incorrectMessageLengthOrInvalidFormat',
  0x14: 'responseTooLong',
  0x21: 'busyRepeatRequest',
  0x22: 'conditionsNotCorrect',
  0x24: 'requestSequenceError',
  0x25: 'noResponseFromSubnetComponent',
  0x26: 'failurePreventsExecutionOfRequestedAction',
  0x31: 'requestOutOfRange',
  0x33: 'securityAccessDenied',
  0x35: 'invalidKey',
  0x36: 'exceededNumberOfAttempts',
  0x37: 'requiredTimeDelayNotExpired',
  0x70: 'uploadDownloadNotAccepted',
  0x71: 'transferDataSuspended',
  0x72: 'generalProgrammingFailure',
  0x73: 'wrongBlockSequenceCounter',
  0x78: 'requestCorrectlyReceivedResponsePending',
  0x7e: 'subFunctionNotSupportedInActiveSession',
  0x7f: 'serviceNotSupportedInActiveSession',
};

export type UdsResult =
  | { kind: 'positive'; service: number; data: Uint8Array; raw: Uint8Array; pendingResponses: number }
  | { kind: 'negative'; service: number; nrc: number; name: string; raw: Uint8Array; pendingResponses: number };

export interface UdsOptions {
  /** Time to wait for the first answer (P2), ms. */
  p2Ms: number;
  /** Time to wait after a "response pending" answer (P2*), ms. */
  p2StarMs: number;
  maxPending: number;
}

export const DEFAULT_UDS: UdsOptions = { p2Ms: 1000, p2StarMs: 5000, maxPending: 20 };

export class UdsClient {
  constructor(private readonly link: IsoTpLink, private readonly options: UdsOptions = DEFAULT_UDS) {}

  /** Sends a request and returns the final answer, waiting through "response pending" (NRC 78). */
  async request(bytes: Uint8Array): Promise<UdsResult> {
    if (bytes.length === 0) throw new IsoTpError('invalid-length');
    const service = bytes[0];
    let reply = await this.link.transact(bytes, this.options.p2Ms);
    for (let pending = 0; ; ) {
      if (reply[0] === 0x7f && reply.length >= 3 && reply[1] === service) {
        if (reply[2] === 0x78) {
          pending += 1;
          if (pending > this.options.maxPending) throw new IsoTpError('timeout', 'too many response-pending answers');
          reply = await this.link.receive(this.options.p2StarMs);
          continue;
        }
        return { kind: 'negative', service, nrc: reply[2], name: NRC_NAMES[reply[2]] ?? 'unknown', raw: reply, pendingResponses: pending };
      }
      if (reply[0] === service + 0x40) return { kind: 'positive', service, data: reply.slice(1), raw: reply, pendingResponses: pending };
      // A message that answers some other request: keep waiting for ours instead of mislabelling it.
      reply = await this.link.receive(this.options.p2Ms);
    }
  }
}

export const buildSessionControl = (sub: number) => Uint8Array.of(0x10, sub);
export const buildTesterPresent = () => Uint8Array.of(0x3e, 0x00);
export const buildReadDid = (dids: number[]) => Uint8Array.of(0x22, ...dids.flatMap((d) => [d >> 8, d & 0xff]));
export const buildSeedRequest = (level: number) => Uint8Array.of(0x27, level);
export const buildKeySend = (level: number, key: Uint8Array) => Uint8Array.of(0x27, level + 1, ...key);

export function serviceName(service: number): string {
  return SERVICE_NAMES[service] ?? `service 0x${service.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** Plain reading of a positive answer for the services this workspace has buttons for; otherwise null. */
export function describePositive(result: Extract<UdsResult, { kind: 'positive' }>): string | null {
  const d = result.data;
  switch (result.service) {
    case 0x10:
      return d.length >= 5 ? `Session ${d[0].toString(16).padStart(2, '0')} active · P2 ${(d[1] << 8) | d[2]} ms · P2* ${((d[3] << 8) | d[4]) * 10} ms` : null;
    case 0x3e:
      return 'Tester present acknowledged';
    case 0x27:
      return d[0] !== undefined && d[0] % 2 === 1 ? `Seed: ${Array.from(d.slice(1), (b) => b.toString(16).padStart(2, '0')).join(' ').toUpperCase()}` : 'Key accepted';
    case 0x22:
      return d.length >= 2 ? `Data for ${Array.from(d.slice(0, 2), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}: ${asciiPreview(d.slice(2))}` : null;
    default:
      return null;
  }
}

/** A readable view of data bytes: the text itself when it is all printable, otherwise hex plus a text view with dots for the rest. */
export function asciiPreview(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ').toUpperCase();
  if (bytes.length === 0) return 'no data';
  if (bytes.every((b) => b >= 0x20 && b < 0x7f)) return `"${String.fromCharCode(...bytes)}"`;
  const text = Array.from(bytes, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
  return `${hex} · text “${text}”`;
}
