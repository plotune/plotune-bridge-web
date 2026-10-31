import { describe, expect, it } from 'vitest';
import { decodeMessage, extractRaw, indexMessages } from '../src/dbc/decode';
import { parseDbc } from '../src/dbc/parse';
import { DbcError } from '../src/dbc/types';

// The "Hospital bed" example from the CANoe training video, plus the layouts that matter.
const BED = `VERSION ""

NS_ :
	CM_
	VAL_

BS_:

BU_: Bed Control_Unit

BO_ 50 Bed_Data: 2 Bed
 SG_ HeadPosition : 0|8@1+ (1,0) [0|255] "" Control_Unit
 SG_ Light : 8|1@1+ (1,0) [0|1] "" Control_Unit

BO_ 100 Control_Unit_Data: 2 Control_Unit
 SG_ HeadAdjustment : 0|2@1- (1,0) [-2|1] "" Bed
 SG_ LightSwitch : 2|1@1+ (1,0) [0|1] "" Bed

CM_ SG_ 50 Light "multi
line comment with BO_ 999 Fake: 8 X
inside";
VAL_ 50 Light 1 "On" 0 "Off" ;
VAL_ 100 HeadAdjustment -1 "Down" 0 "Hold" 1 "Up" ;
`;

const find = (text: string, id: number, extended = false) => {
  const dbc = parseDbc(text);
  const message = indexMessages(dbc)(id, extended);
  if (!message) throw new Error('missing message');
  return { dbc, message };
};

describe('parseDbc', () => {
  it('reads messages, signals, units and value tables, and skips multi-line comments', () => {
    const dbc = parseDbc(BED);
    expect(dbc.warnings).toEqual([]);
    expect(dbc.messages.map((m) => [m.id, m.name, m.dlc, m.transmitter])).toEqual([
      [50, 'Bed_Data', 2, 'Bed'],
      [100, 'Control_Unit_Data', 2, 'Control_Unit'],
    ]);
    const light = dbc.messages[0].signals[1];
    expect([light.startBit, light.length, light.byteOrder, light.signed]).toEqual([8, 1, 'intel', false]);
    expect(light.labels.get(1)).toBe('On');
    expect(dbc.messages[1].signals[0].labels.get(-1)).toBe('Down');
  });

  it('tolerates CRLF, a byte-order mark and tabs', () => {
    const text = String.fromCharCode(0xfeff) + BED.replace(/\n/g, '\r\n').replace(/^ SG_/gm, '\tSG_');
    expect(parseDbc(text).messages).toHaveLength(2);
  });

  it('marks extended identifiers by bit 31 and keeps the 29-bit id', () => {
    const { message } = find('BO_ 2566844672 Ext: 8 X\n SG_ A : 0|8@1+ (1,0) [0|0] "" Y\n', 0x18fef100, true);
    expect(message.extended).toBe(true);
    expect(message.id).toBe(0x18fef100);
  });

  it('rejects a file with no messages and a signal outside any message, in plain words', () => {
    expect(() => parseDbc('hello')).toThrow(DbcError);
    expect(() => parseDbc('hello')).toThrow(/No messages found/);
    expect(() => parseDbc(' SG_ A : 0|8@1+ (1,0) [0|0] "" Y\n')).toThrow(/before any message/);
    expect(() => parseDbc('BO_ 1 A: 8 X\n SG_ B : 0|65@1+ (1,0) [0|0] "" Y\n')).toThrow(/1 to 64/);
  });

  it('warns about extended multiplexing and duplicate identifiers instead of failing', () => {
    const dbc = parseDbc('BO_ 1 A: 8 X\n SG_ S M : 0|4@1+ (1,0) [0|0] "" Y\n SG_ T m1M : 4|4@1+ (1,0) [0|0] "" Y\nBO_ 1 B: 8 X\n');
    expect(dbc.warnings.some((w) => /extended multiplexing/.test(w))).toBe(true);
    expect(dbc.warnings.some((w) => /repeats an identifier/.test(w))).toBe(true);
  });
});

describe('decodeMessage', () => {
  it('decodes the video example: HeadPosition E7 = 231 and Light on, with its label', () => {
    const { message } = find(BED, 50);
    const [head, light] = decodeMessage(message, Uint8Array.of(0xe7, 0x01));
    expect(head).toMatchObject({ name: 'HeadPosition', value: 231, unit: '' });
    expect(light).toMatchObject({ name: 'Light', value: 1, label: 'On' });
  });

  it('sign-extends a 2-bit signed signal: 0b11 is -1 ("Down"), 0b01 is 1', () => {
    const { message } = find(BED, 100);
    expect(decodeMessage(message, Uint8Array.of(0b011, 0))[0]).toMatchObject({ value: -1, label: 'Down' });
    expect(decodeMessage(message, Uint8Array.of(0b001, 0))[0]).toMatchObject({ value: 1, label: 'Up' });
    expect(decodeMessage(message, Uint8Array.of(0b010, 0))[0]).toMatchObject({ value: -2 });
  });

  it('applies factor and offset: raw 100 * 0.5 - 40 = 10 degC', () => {
    const { message } = find('BO_ 7 T: 1 X\n SG_ Temp : 0|8@1+ (0.5,-40) [-40|87.5] "degC" Y\n', 7);
    expect(decodeMessage(message, Uint8Array.of(100))[0]).toMatchObject({ value: 10, unit: 'degC' });
  });

  it('reads a Motorola (big-endian) 16-bit signal: bytes 01 02 are 258; start bit is the MSB', () => {
    const { message } = find('BO_ 8 M: 2 X\n SG_ Big : 7|16@0+ (1,0) [0|0] "" Y\n', 8);
    expect(decodeMessage(message, Uint8Array.of(0x01, 0x02))[0].value).toBe(0x0102);
  });

  it('reads a Motorola signal that crosses a byte at a non-aligned start: 12 bits from bit 11', () => {
    // Start bit 11 is bit 3 of byte 1. The signal takes bits 11, 10, 9, 8, then continues at bit 7 of byte 2 (position 23) down.
    const signal = find('BO_ 9 M: 3 X\n SG_ S : 11|12@0+ (1,0) [0|0] "" Y\n', 9).message.signals[0];
    // byte1 = 0b0000_1010 (bits 3..0 -> 1010), byte2 = 0b1100_1100 (top 8 bits)
    expect(extractRaw(signal, Uint8Array.of(0, 0b0000_1010, 0b1100_1100))).toBe(0b1010_1100_1100n);
  });

  it('reads a 64-bit Intel signal without losing precision', () => {
    const { message } = find('BO_ 10 W: 8 X\n SG_ Big : 0|64@1+ (1,0) [0|0] "" Y\n', 10);
    const decoded = decodeMessage(message, Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff))[0];
    expect(decoded.raw).toBe(2n ** 64n - 1n);
  });

  it('decodes IEEE floats from SIG_VALTYPE_', () => {
    const { message } = find('BO_ 11 F: 4 X\n SG_ V : 0|32@1+ (1,0) [0|0] "V" Y\nSIG_VALTYPE_ 11 V : 1;\n', 11);
    expect(decodeMessage(message, Uint8Array.of(0x00, 0x00, 0x20, 0x41))[0].value).toBe(10); // 0x41200000 = 10.0, little endian
  });

  it('shows a multiplexed signal only when its switch matches', () => {
    const text = 'BO_ 12 Mx: 2 X\n SG_ Sel M : 0|4@1+ (1,0) [0|0] "" Y\n SG_ A m0 : 8|8@1+ (1,0) [0|0] "" Y\n SG_ B m1 : 8|8@1+ (1,0) [0|0] "" Y\n';
    const { message } = find(text, 12);
    expect(decodeMessage(message, Uint8Array.of(0x00, 0x2a)).map((s) => s.name)).toEqual(['Sel', 'A']);
    expect(decodeMessage(message, Uint8Array.of(0x01, 0x2a)).map((s) => s.name)).toEqual(['Sel', 'B']);
    expect(decodeMessage(message, Uint8Array.of(0x02, 0x2a)).map((s) => s.name)).toEqual(['Sel']);
  });

  it('leaves out signals that do not fit in a short frame, and never guesses', () => {
    const { message } = find(BED, 50);
    expect(decodeMessage(message, Uint8Array.of(0xe7)).map((s) => s.name)).toEqual(['HeadPosition']);
  });

  it('keeps standard and extended identifiers apart', () => {
    const dbc = parseDbc('BO_ 291 Std: 1 X\n SG_ A : 0|8@1+ (1,0) [0|0] "" Y\nBO_ 2147483939 Ext: 1 X\n SG_ B : 0|8@1+ (1,0) [0|0] "" Y\n');
    const lookup = indexMessages(dbc);
    expect(lookup(291, false)?.name).toBe('Std');
    expect(lookup(291, true)?.name).toBe('Ext');
    expect(lookup(292, false)).toBeUndefined();
  });
});
