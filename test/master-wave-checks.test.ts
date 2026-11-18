import { describe, expect, it } from 'vitest';
import { openSteps, timers } from '../shared/engine/index.js';
import { blocking, masterChecks } from '../shared/master/checks.js';
import type { MasterDoc } from '../shared/master/schema.js';
import { at, ev, api, unplaced } from './engine-fixture.js';
// The problems, without the rooms a stage must name (TA-11): the fixtures name none.
const checks = (d: Parameters<typeof masterChecks>[0]) => unplaced(masterChecks(d));

// Calculation checks from the TrueBatch Tablets formulation test (waves 1-5) that apply to API masters: not GMP rules.
type Change = (d: MasterDoc) => void;
const lines = (change: Change) => { const d = api(); change(d); return checks(d).map((p) => `${p.level} ${p.rule ?? '-'} ${p.path}: ${p.message}`); };
const only = (level: string, path: string) => (change: Change) => lines(change).filter((p) => p.startsWith(`${level} `) && p.includes(` ${path}: `));
const step = (d: MasterDoc, stage: string, key: string) => d.stages.find((s) => s.key === stage)!.steps.find((t) => t.key === key)!;
/** The change, then the warning `key` answered with `choice`. */
const answered = (change: Change, key: string, choice: string): Change => (d) => {
  change(d);
  const q = checks(d).find((p) => p.question?.key === key)!;
  d.answers = { ...d.answers, [key]: { about: q.message, choice, reason: '' } };
};
describe('calculation checks ⚠️ from the formulation test', () => {
  const sizeTest = (limit: object): Change => (d) => { step(d, 'drying', 'qa-hold').settings = { what: 'API lot d90 (certificate)', unit: 'µm', limit: limit as never }; };
  it.each<[string, Change, Change, string, string, string]>([
    ['M8 an ICH Q3C Class 1 solvent (benzene) needs a reason and a residual-solvent test (API template test)',
      (d) => { d.formula[4]!.name = 'Benzene'; }, () => {}, 'class-1/toluene', 'formula[4]', 'needed, tested'],
    ['F0204 a solvent-wet starting material weighed without a solvent correction',
      (d) => { Object.assign(d.formula[0]!, { name: 'Examplol acid wet cake', adjust: { potency: { basis: 'as is', standardIs: 'anhydrous' } } }); },
      (d) => { d.formula[0]!.name = 'Examplol acid wet cake'; }, 'solvent-wet/ksm', 'formula[0]', 'weighed dry'],
    ['F0490 a particle-size limit on one side only (d90 not more than 10 µm)',
      sizeTest({ high: '10', unit: 'µm' }), sizeTest({ low: '2', high: '10', unit: 'µm' }), 'two-sided/drying/qa-hold', 'stages[3].steps[1].settings.limit', 'one side is enough'],
    ['F0318 an order-critical step moved before the step it must follow',
      (d) => { step(d, 'step1', 'charge-ksm').orderAfter = 'react'; }, (d) => { step(d, 'step1', 'charge-ksm').orderAfter = 'weigh-amine'; },
      'order/step1/charge-ksm', 'stages[1].steps[2]', 'new order confirmed'],
  ])('calculation check ⚠️ %s: fires, passes, and once answered no longer blocks', (_what, fires, passes, key, path, choice) => {
    const d = api();
    fires(d);
    const q = checks(d).find((p) => p.question?.key === key)!;
    expect(q).toMatchObject({ level: 'warning', path, question: { options: expect.arrayContaining([choice]) } });
    expect(blocking(q)).toBe(true);
    const ok = api();
    passes(ok);
    expect(checks(ok).some((p) => p.question?.key === key)).toBe(false);
    d.answers = { [key]: { about: q.message, choice, reason: q.question!.needsReason ? 'Per the development report' : '' } };
    expect(blocking(checks(d).find((p) => p.question?.key === key)!)).toBe(false);
  });
});

describe('F4 by rule and F6 with a changing interval (data-level options)', () => {
  it('F4 F0040: a step only for a batch of at most 150 kg is in for 100 kg and left out at 50 kg, with no operator choice', () => {
    const rule = (high: string): Change => (d) => { step(d, 'salt', 'yield').onlyIf = { header: 'batchSize', limit: { high, unit: 'kg' } }; };
    const v = (change: Change) => { const d = api(); change(d); return openSteps(d, [], at(0)).steps.find((s) => s.stepKey === 'yield' && s.stageKey === 'salt')!; };
    expect(v(rule('150')).state).not.toBe('not_applicable');
    expect(v(rule('50'))).toMatchObject({ state: 'not_applicable', leftOut: expect.stringMatching(/only when the batch size is/) });
    expect(only('error', 'stages[2].steps[1].onlyIf')((d) => { step(d, 'salt', 'yield').onlyIf = { header: 'batchSize', limit: { high: '50', unit: 'min' } }; }))
      .toEqual([expect.stringMatching(/The rule for leaving the step out: .*cannot be converted/)]);
  });

  it('F6 F0030: readings every 30 min, then every 15 min after 60 min; a later interval above the block\'s 480 min is refused', () => {
    const d = api();
    step(d, 'salt', 'crystallise').everyMinutesLater = { afterMinutes: 60, everyMinutes: 15 };
    expect(checks(d)).toEqual([]);
    const events = [ev('started', '2.1.0.1', { min: 0 }), ev('started', '2.1.0.2', { min: 30 }), ev('started', '2.1.0.3', { min: 60 })];
    const t = timers(d, events, at(61)).find((x) => x.kind === 'periodic' && x.key.round === 4)!;
    expect([t.at.getTime() - at(0).getTime(), t.label]).toEqual([75 * 60_000, 'Check 4 of “Process to an end point” (every 15 min)']);
    step(d, 'salt', 'crystallise').everyMinutesLater = { afterMinutes: 60, everyMinutes: 600 };
    expect(checks(d).map((p) => p.message)).toEqual(['Periodic checks every 600 min: they must be at least every 480 min']);
  });
});
