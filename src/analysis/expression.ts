// Calculated signals: a small formula language over the signals of a recording. It is parsed and evaluated here, never run as code,
// so a formula from a shared project cannot do anything but arithmetic. Inputs are step-interpolated: a signal keeps its last value until it changes.
import { lowerBound, type SignalData } from './math';

type Node =
  | { k: 'num'; v: number }
  | { k: 'sig'; name: string }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/'; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

const FUNCTIONS: Record<string, { min: number; max: number; run: (a: number[]) => number }> = {
  abs: { min: 1, max: 1, run: (a) => Math.abs(a[0]!) },
  sqrt: { min: 1, max: 1, run: (a) => Math.sqrt(a[0]!) },
  min: { min: 2, max: 8, run: (a) => Math.min(...a) },
  max: { min: 2, max: 8, run: (a) => Math.max(...a) },
};

export class FormulaError extends Error {}

function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\s*(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|[-+*/(),])/gy;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) {
      if (src.slice(pos).trim() === '') break;
      throw new FormulaError(`Unexpected character “${src.slice(pos).trim()[0]}”.`);
    }
    out.push(m[1]!);
    pos = re.lastIndex;
  }
  return out;
}

export function parseFormula(src: string): Node {
  if (src.length > 500) throw new FormulaError('The formula is too long.');
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new FormulaError('Write a formula first.');
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expect = (t: string) => { if (next() !== t) throw new FormulaError(`Expected “${t}”.`); };
  const primary = (depth: number): Node => {
    if (depth > 40) throw new FormulaError('The formula is nested too deeply.');
    const t = next();
    if (t === undefined) throw new FormulaError('The formula ends too early.');
    if (t === '(') { const e = expr(depth + 1); expect(')'); return e; }
    if (t === '-') return { k: 'neg', a: primary(depth + 1) };
    if (/^[\d.]/.test(t)) return { k: 'num', v: Number(t) };
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        const f = FUNCTIONS[t];
        if (!f) throw new FormulaError(`“${t}” is not a function. Use abs, sqrt, min or max.`);
        next();
        const args: Node[] = [];
        if (peek() !== ')') { args.push(expr(depth + 1)); while (peek() === ',') { next(); args.push(expr(depth + 1)); } }
        expect(')');
        if (args.length < f.min || args.length > f.max) throw new FormulaError(`${t} takes ${f.min === f.max ? f.min : `${f.min} to ${f.max}`} values.`);
        return { k: 'call', fn: t, args };
      }
      return { k: 'sig', name: t };
    }
    throw new FormulaError(`Unexpected “${t}”.`);
  };
  const term = (depth: number): Node => {
    let a = primary(depth);
    while (peek() === '*' || peek() === '/') { const op = next() as '*' | '/'; a = { k: 'bin', op, a, b: primary(depth) }; }
    return a;
  };
  const expr = (depth: number): Node => {
    let a = term(depth);
    while (peek() === '+' || peek() === '-') { const op = next() as '+' | '-'; a = { k: 'bin', op, a, b: term(depth) }; }
    return a;
  };
  const tree = expr(0);
  if (i < tokens.length) throw new FormulaError(`Unexpected “${tokens[i]}”.`);
  return tree;
}

export function signalsUsed(node: Node, out = new Set<string>()): Set<string> {
  if (node.k === 'sig') out.add(node.name);
  else if (node.k === 'neg') signalsUsed(node.a, out);
  else if (node.k === 'bin') { signalsUsed(node.a, out); signalsUsed(node.b, out); }
  else if (node.k === 'call') node.args.forEach((a) => signalsUsed(a, out));
  return out;
}

function evalAt(node: Node, vals: Map<string, number>): number {
  switch (node.k) {
    case 'num': return node.v;
    case 'sig': return vals.get(node.name) ?? NaN;
    case 'neg': return 0 - evalAt(node.a, vals);
    case 'bin': {
      const a = evalAt(node.a, vals);
      const b = evalAt(node.b, vals);
      return node.op === '+' ? a + b : node.op === '-' ? a - b : node.op === '*' ? a * b : a / b;
    }
    case 'call': return FUNCTIONS[node.fn]!.run(node.args.map((a) => evalAt(a, vals)));
  }
}

/**
 * Evaluates a formula on the time base of the first signal it uses. `inputs` maps names in the formula to signals.
 * Where an input has no value yet (before its first sample) the point is skipped.
 */
export function evaluate(src: string, inputs: ReadonlyMap<string, SignalData>): { t: Float64Array; v: Float64Array } {
  const tree = parseFormula(src);
  const names = [...signalsUsed(tree)];
  if (names.length === 0) throw new FormulaError('Use at least one signal in the formula.');
  for (const n of names) if (!inputs.has(n)) throw new FormulaError(`There is no signal called “${n}”.`);
  const base = inputs.get(names[0]!)!;
  const t: number[] = [];
  const v: number[] = [];
  const vals = new Map<string, number>();
  for (let k = 0; k < base.t.length; k += 1) {
    const x = base.t[k]!;
    let ok = true;
    for (const n of names) {
      const s = inputs.get(n)!;
      const j = n === names[0] ? k : lowerBound(s.t, x + 1e-12) - 1;
      if (j < 0) { ok = false; break; }
      vals.set(n, s.v[j]!);
    }
    if (!ok) continue;
    const out = evalAt(tree, vals);
    if (Number.isFinite(out)) { t.push(x); v.push(out); }
  }
  return { t: Float64Array.from(t), v: Float64Array.from(v) };
}
