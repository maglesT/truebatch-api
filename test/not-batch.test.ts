import { describe, expect, it } from 'vitest';
import { blockProblems } from '../shared/blocks/format.js';
import { BLOCKS, findBlock } from '../shared/blocks/index.js';
import { masterChecks } from '../shared/master/checks.js';
import type { MasterDoc, SettingValue, Step } from '../shared/master/schema.js';
import { api, unplaced } from './engine-fixture.js';

// Port of Tablets round 31: a tolerance (notBatch) is typed only, so a formula line's batch quantity of some kilograms
// cannot let every round of drying to constant weight pass. And a formula line is refused for a setting of another
// known kind than the line's own (in API a line is a mass, a volume or a count: kg, L or units).

const errors = (d: MasterDoc) => unplaced(masterChecks(d)).filter((p) => p.level === 'error').map((p) => `${p.path}: ${p.message}`);
/** The fixture with a step added at the end of step 1 (before the yield); returns the doc and the step's settings path. */
function withStep(block: string, settings: Step['settings'], flow: Step['flow'] = { kind: 'none' }): [MasterDoc, string] {
  const d = api();
  const si = d.stages.findIndex((s) => s.key === 'step1');
  const steps = d.stages[si]!.steps;
  steps.splice(steps.length - 1, 0, { key: 'added', block: { id: block, version: 1 }, checker: true, waitForCheck: false, critical: false, flow, settings });
  return [d, `stages[${si}].steps[${steps.length - 2}].settings`];
}
const dryConstant = (maxChange: SettingValue) => withStep('dry-constant', { maxChange }, { kind: 'repeat-until', maxRounds: 5 });

describe('a tolerance (notBatch)', () => {
  it('is set on the largest change between rounds of drying to constant weight only', () => {
    expect(BLOCKS.flatMap((b) => b.settings.filter((s) => s.notBatch).map((s) => `${b.id}.${s.name}: ${s.notBatch}`))).toEqual(['dry-constant.maxChange: tolerance']);
    for (const b of BLOCKS) expect(blockProblems(b)).toEqual([]);
    const b = findBlock({ id: 'dry-constant', version: 1 })!;
    expect(blockProblems({ ...b, settings: [{ name: 'x', label: 'X', kind: 'limit', notBatch: 'tolerance' }] }).filter((p) => p.includes('not a batch')))
      .toEqual(['setting x: only a quantity setting is marked not a batch quantity']);
  });

  it('is typed only: a formula line, the batch size, an earlier step and the molar yield are refused', () => {
    expect(errors(dryConstant('0.5 g')[0])).toEqual([]);
    const cases: [SettingValue, string][] = [
      [{ formula: 'ksm' }, 'the batch quantity of Examplol acid'],
      [{ formula: 'ksm', adjusted: true }, 'the batch quantity of Examplol acid'],
      [{ header: 'batchSize' }, 'the batch size'],
      [{ ref: 'step1/weigh-ksm/net' }, 'step1/weigh-ksm/net (an earlier step)'],
      [{ molar: true }, 'the molar theoretical yield'],
    ];
    for (const [v, what] of cases) {
      const [d, p] = dryConstant(v);
      expect(errors(d)).toContain(`${p}.maxChange: Largest change between rounds is a tolerance: type it (${what} is not a tolerance)`);
    }
  });
});

describe('a formula line on a setting of another kind than the line', () => {
  it('a count or a mass refuses a line of another kind; a line of the same kind is taken', () => {
    const [d, p] = withStep('container-issue', { material: { formula: 'ksm' }, expected: { formula: 'ksm' } });
    expect(errors(d)).toContain(`${p}.expected: Count expected: a formula line gives its batch quantity (a mass), but this step needs a count: type the value`);
    // The weigh target is a mass: purified water (L) is refused, the starting material (kg) taken.
    const [w, q] = withStep('weigh', { target: { formula: 'water' }, tolerance: '0.5' });
    expect(errors(w)).toContain(`${q}.target: Target quantity: a formula line gives its batch quantity (a volume), but this step needs a mass: type the value`);
    expect(errors(withStep('weigh', { target: { formula: 'ksm' }, tolerance: '0.5' })[0]).filter((e) => e.includes('a formula line gives'))).toEqual([]);
  });

  it('a liquid charged in litres takes a line in L, per kg of the key input (L/kg) or by equivalents in L', () => {
    for (const line of ['water', 'toluene', 'hcl']) {
      const [d] = withStep('charge-liquid', { unit: 'L', target: { formula: line }, tolerance: '2.0' });
      expect(errors(d).filter((e) => e.includes('a formula line gives'))).toEqual([]);
    }
    expect(errors(api())).toEqual([]);
  });
});
