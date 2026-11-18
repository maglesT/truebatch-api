/**
 * T28 Molar quantity (TrueBatch API): a charge by molar equivalents of the stage's key input, and the molar theoretical
 * yield of a stage. mol of key input = mass × assay ÷ MW; a reagent = mol × eq × its MW ÷ its assay (as a volume when
 * its density is given); the theoretical product = mol × product per mol × MW of the product. MWs in g/mol, as plain
 * decimals (as T11's forms). The assay of the reagent is applied by T9 when its line is adjusted, never here.
 */
import { checkOf, defaultDecimals, Dec, fmt, HUNDRED, needKind, num, parse, refuse, run, show, to, unitOf, type Outcome, type Q } from './core.js';
import type { Limit } from './rounding.js';
import { convert } from './units.js';

export type T28Input = {
  /** The key input of the stage, as charged (a mass), its MW and its assay in % (default 100). */
  readonly key: Q; readonly keyMw: string; readonly keyAssay?: Q;
  readonly unit?: string; readonly decimals?: number; readonly limit?: Limit;
} & (
  | { readonly mode: 'equivalents'; readonly eq: string; readonly mw: string; readonly density?: Q }
  | { readonly mode: 'theoretical yield'; readonly mw: string; readonly perMol?: string }
);

const positive = (text: string, what: string): Dec => {
  const v = num(text, what);
  if (!v.isPositive() || v.isZero()) refuse(`${what} must be more than zero`);
  return v;
};

/** T28 Molar quantity: by equivalents of the key input, or the molar theoretical yield. */
export function t28MolarQuantity(i: T28Input): Outcome<{ readonly mol: Dec }> {
  return run(() => {
    const k = parse(i.key, 'The key input');
    needKind(k, ['mass'], 'The key input');
    const keyMw = positive(i.keyMw, 'The molecular weight of the key input');
    const assay = i.keyAssay === undefined ? new Dec(100) : parse(i.keyAssay, 'The assay of the key input').v;
    if (!assay.isPositive() || assay.gt(HUNDRED)) refuse('The assay of the key input must be more than 0 and at most 100 %');
    // kg ÷ (g/mol) = kmol; shown in mol.
    const mol = to(k, 'kg').times(assay).div(HUNDRED).div(keyMw).times(1000);
    const assayText = i.keyAssay === undefined ? '' : ` × ${fmt(assay, 1)} %`;
    const molText = `${k.text}${assayText} ÷ ${i.keyMw} g/mol = ${fmt(mol, 3)} mol`;
    const mw = positive(i.mw, 'The molecular weight');
    let kg: Dec;
    let line: string;
    if (i.mode === 'equivalents') {
      const eq = positive(i.eq, 'The equivalents');
      kg = mol.times(eq).times(mw).div(1000);
      line = `${molText} × ${i.eq} eq × ${i.mw} g/mol`;
      if (i.density !== undefined) {
        const d = parse(i.density, 'The density');
        if (!d.v.isPositive() || d.v.isZero()) refuse('The density must be more than zero');
        const litres = kg.div(to(d, 'kg/L'));
        const u = unitOf(i.unit ?? 'L');
        if (u.kind !== 'volume') refuse('A charge by density is a volume');
        const value = convert(litres, unitOf('L'), u);
        const dp = i.decimals ?? defaultDecimals(u.symbol);
        return { ok: true, mol, value, unit: u.symbol, shown: `${line} ÷ ${d.text} = ${show(value, u.symbol, dp)}`, ...checkOf(value, u.symbol, i.limit) };
      }
    } else {
      const perMol = i.perMol === undefined ? new Dec(1) : positive(i.perMol, 'The product per mol of key input');
      kg = mol.times(perMol).times(mw).div(1000);
      line = `${molText}${i.perMol === undefined ? '' : ` × ${i.perMol}`} × ${i.mw} g/mol (theoretical)`;
    }
    const u = unitOf(i.unit ?? 'kg');
    if (u.kind !== 'mass') refuse('The result of a molar quantity is a mass');
    const value = convert(kg, unitOf('kg'), u);
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    return { ok: true, mol, value, unit: u.symbol, shown: `${line} = ${show(value, u.symbol, dp)}`, ...checkOf(value, u.symbol, i.limit) };
  });
}
