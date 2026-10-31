// A parsed CAN database (DBC). Plain data: nothing here depends on React, the transport or CAN hardware,
// so Bridge DAQ and log readers can reuse the same signal model.

export type ByteOrder = 'intel' | 'motorola';

export type Multiplexing = { kind: 'none' } | { kind: 'switch' } | { kind: 'muxed'; value: number };

export interface DbcSignal {
  name: string;
  /** DBC bit number of the first bit: the least significant bit for Intel, the most significant bit for Motorola. */
  startBit: number;
  length: number;
  byteOrder: ByteOrder;
  signed: boolean;
  /** 32 or 64 when the signal is an IEEE float (SIG_VALTYPE_). */
  float: 32 | 64 | null;
  factor: number;
  offset: number;
  min: number;
  max: number;
  unit: string;
  mux: Multiplexing;
  /** Raw value to label, from VAL_. */
  labels: ReadonlyMap<number, string>;
}

export interface DbcMessage {
  /** The 11-bit or 29-bit identifier, without the extended flag. */
  id: number;
  extended: boolean;
  name: string;
  dlc: number;
  transmitter: string;
  signals: DbcSignal[];
}

export interface Dbc {
  messages: DbcMessage[];
  /** Things the file uses that this reader does not support yet. The rest of the file still loads. */
  warnings: string[];
}

export class DbcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbcError';
  }
}

export interface DecodedSignal {
  name: string;
  /** The scaled, physical value (raw * factor + offset). */
  value: number;
  raw: bigint;
  unit: string;
  /** The VAL_ label for the raw value, when the file defines one. */
  label?: string;
}
