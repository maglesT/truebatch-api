import { describe, expect, it } from 'vitest';
import { t28MolarQuantity } from '../../shared/templates/molar.js';
import { ok, refused } from './helpers.js';

// Numbers from the template test (patent maps, api-template-test.md): hercynine 197.24, bromine 159.81 (d 3.11),
// 3-mercaptopropionic acid 106.14 (d 1.218), ergothioneine 229.30.
describe('T28 Molar quantity', () => {
  it('T28 a reagent by equivalents of the key input: 98.6 g hercynine, 1.3 eq bromine = 103.9 g', () => {
    const r = ok(t28MolarQuantity({ mode: 'equivalents', key: '98.6 g', keyMw: '197.24', eq: '1.3', mw: '159.81', unit: 'g' }));
    expect(r.mol.toFixed(4)).toBe('0.4999');
    expect(r.value.toFixed(1)).toBe('103.9');
    expect(r.shown).toBe('98.6 g ÷ 197.24 g/mol = 0.500 mol × 1.3 eq × 159.81 g/mol = 103.86 g');
  });

  it('T28 a liquid by equivalents is a volume through its density: 10 eq of the thiol on 0.5 mol = 435.7 mL', () => {
    const r = ok(t28MolarQuantity({ mode: 'equivalents', key: '98.62 g', keyMw: '197.24', eq: '10', mw: '106.14', density: '1.218 g/mL', unit: 'mL' }));
    expect(r.unit).toBe('mL');
    expect(r.value.toFixed(1)).toBe('435.7');
  });

  it('T28 the key input assay counts: 100 kg at 98.0 % is 98 kg of key input', () => {
    const r = ok(t28MolarQuantity({ mode: 'equivalents', key: '100 kg', keyMw: '100', keyAssay: '98.0 %', eq: '1', mw: '100' }));
    expect(r.value.toFixed(3)).toBe('98.000');
    expect(r.unit).toBe('kg');
  });

  it('T28 the molar theoretical yield: 0.5 mol hercynine × 229.30 = 114.65 g ergothioneine', () => {
    const r = ok(t28MolarQuantity({ mode: 'theoretical yield', key: '98.62 g', keyMw: '197.24', mw: '229.30', unit: 'g' }));
    expect(r.value.toFixed(2)).toBe('114.65');
    expect(r.shown).toMatch(/× 229\.30 g\/mol \(theoretical\) = 114\.65 g$/);
    // Two product molecules per key input (a dimer split): twice the theoretical.
    expect(ok(t28MolarQuantity({ mode: 'theoretical yield', key: '98.62 g', keyMw: '197.24', mw: '229.30', perMol: '2', unit: 'g' })).value.toFixed(2)).toBe('229.30');
  });

  it.each([
    [{ mode: 'equivalents' as const, key: '1 kg', keyMw: '0', eq: '1', mw: '100' }, /molecular weight of the key input must be more than zero/],
    [{ mode: 'equivalents' as const, key: '1 kg', keyMw: '100', eq: '0', mw: '100' }, /equivalents must be more than zero/],
    [{ mode: 'equivalents' as const, key: '1 kg', keyMw: '100', eq: '1', mw: '-5' }, /molecular weight must be more than zero/],
    [{ mode: 'equivalents' as const, key: '1 L', keyMw: '100', eq: '1', mw: '100' }, /key input/],
    [{ mode: 'equivalents' as const, key: '1 kg', keyMw: '100', keyAssay: '120 %', eq: '1', mw: '100' }, /assay of the key input/],
    [{ mode: 'theoretical yield' as const, key: '1 kg', keyMw: '100', mw: '100', perMol: '0' }, /product per mol/],
  ])('T28 refuses %o', (i, why) => {
    expect(refused(t28MolarQuantity(i))).toMatch(why);
  });
});
