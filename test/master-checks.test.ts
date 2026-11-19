import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../shared/blocks/index.js';
import { blockProblems, type Block } from '../shared/blocks/format.js';
import { evaluate } from '../shared/engine/index.js';
import { blocking, masterChecks } from '../shared/master/checks.js';
import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import { placed, api, unplaced } from './engine-fixture.js';
// The problems, without the rooms a stage must name (TA-11): the fixtures name none.
const checks = (d: Parameters<typeof masterChecks>[0]) => unplaced(masterChecks(d));

/** The fixture with one change; the problems that change makes. */
function after(change: (d: MasterDoc) => void) {
  const d = api();
  change(d);
  return checks(d).map((p) => `${p.level} ${p.rule ?? '-'} ${p.path}: ${p.message}`);
}
const errors = (change: (d: MasterDoc) => void) => after(change).filter((p) => p.startsWith('error'));
const step = (d: MasterDoc, stage: string, key: string) => d.stages.find((s) => s.key === stage)!.steps.find((t) => t.key === key)!;

describe('blocks are data', () => {
  it.each(BLOCKS.map((b) => [b.id, b] as const))('the %s block is a valid description', (_id, b) => {
    expect(blockProblems(b)).toEqual([]);
  });

  it('no calculation label states its own outcome (the record never reads "Within limits: … OUT OF LIMITS")', () => {
    const labels = BLOCKS.flatMap((b) => b.calcs.map((c) => c.label));
    expect(labels.filter((l) => /within|out of|pass|fail/i.test(l))).toEqual([]);
    expect(labels).toContain('Result against limits');
  });

  it('a block naming an unknown template, field or stop check is refused', () => {
    const bad: Block = { ...BLOCKS[0]!, calcs: [{ name: 'x', label: 'X', template: 'T99', args: { a: '$nothing' } }], stop: 'y' };
    expect(blockProblems(bad)).toEqual(['calculation x: unknown template T99', 'calculation x: "$nothing" is not a field, setting or earlier calculation', 'stop: no calculation y']);
  });
});

describe('master checks', () => {
  it('the fixture API master passes every check', () => {
    expect(checks(api())).toEqual([]);
    expect(unplaced(masterChecks(placed(api())))).toEqual([]);
  });

  it('TA-11 a stage that works machines or names a room, with no rooms chosen, is an error; balances alone are not', () => {
    expect(masterChecks(api()).filter((p) => p.rule === 'TA-11').map((p) => `${p.path}: ${p.message}`)).toEqual(['Base solution', 'Step 1: condensation', 'Step 2: salt formation', 'Drying']
      .map((name, i) => `stages[${i}].roomTypes: Stage ${name}: choose the rooms this stage may run in (an area or a room of master data, in the stage settings)`));
    const d = placed(api());
    d.stages[0]!.roomTypes = [];
    d.stages[0]!.steps = d.stages[0]!.steps.filter((t) => t.block.id === 'weigh');
    expect(masterChecks(d).filter((p) => p.rule === 'TA-11')).toEqual([]);
  });

  it('TA-26 a master that packs fills and labels the containers in its last stage, reconciles every label issued and destroys the leftovers', () => {
    const d = api();
    d.formula.push({ key: 'label', materialItemId: 'm-l', code: 'PM-101', name: 'Drum label', stage: 'pack', role: 'packing material', quantity: '10', unit: 'units' });
    const s = (key: string, block: string, settings: object = {}) => ({ key, block: { id: block, version: 1 }, checker: true, waitForCheck: false, critical: false, flow: { kind: 'none' as const }, settings });
    const pack = { key: 'pack', name: 'Pack and label', kind: 'normal' as const, roomTypes: [], machineTypes: [], role: 'Packing operator', uses: [], steps: [
      s('labels', 'pack-material-issue', { material: { formula: 'label' }, unit: 'units' }),
      { ...s('fill', 'container-fill', { nominal: '25.0 kg', tolerance: '0.5' }), flow: { kind: 'repeat-until' as const, maxRounds: 10 } },
      s('rec', 'printed-reconciliation', { material: { formula: 'label' }, unit: 'units', issued: { ref: 'pack/labels/issued' } }), s('destroy', 'destruction'),
      s('yield', 'stage-yield', { theoretical: { ref: 'drying/yield/output' }, yieldLimit: { low: '99.0', high: '100.5', unit: '%' } })] };
    const ta26 = (change: (p: typeof pack) => void) => { const x = structuredClone(pack); change(x); const m = { ...d, stages: [...d.stages, x as unknown as (typeof d.stages)[number]] }; return checks(m).filter((p) => p.rule === 'TA-26').map((p) => p.message); };
    expect(ta26(() => {})).toEqual([]);
    expect(ta26((p) => { p.steps = p.steps.filter((t) => t.key !== 'fill'); })).toEqual(['The last stage, Pack and label, fills and labels the containers: it needs the Fill and label a container step (Pack and label)']);
    expect(ta26((p) => { p.steps = p.steps.filter((t) => t.key !== 'rec'); })).toEqual(['The labels Drum label issued in Pack and label have no reconciliation step']);
    expect(ta26((p) => { p.steps = p.steps.filter((t) => t.key !== 'destroy'); })).toEqual(['Pack and label issues labels: batch-coded leftovers need the destruction step']);
 
    // The last container may be part-filled (owner, 19 Nov 2026): after the fill step, same nominal fill, one minimum with a low.
    const last = (settings: object) => s('last', 'container-fill-last', { nominal: '25.0 kg', ...settings });
    const withLast = (settings: object, at = 2) => (p: typeof pack) => { p.steps.splice(at, 0, { ...last(settings), flow: { kind: 'qa-hold' } } as never); };
    expect(ta26(withLast({ minimumFill: { low: '5.0', unit: 'kg' } }))).toEqual([]);
    expect(ta26(withLast({ minimumPercent: { low: '20', unit: '%' } }))).toEqual([]);
    expect(ta26(withLast({ minimumPercent: { low: '20', unit: '%' } }, 1))).toEqual(['The part-filled last container comes after the Fill and label a container step']);
    expect(ta26(withLast({ nominal: '20.0 kg', minimumFill: { low: '5.0', unit: 'kg' } }))).toEqual(['The nominal fill is not the one of the Fill and label a container step: make them the same']);
    expect(ta26(withLast({}))).toEqual(['Set the minimum fill of the last container in kg or in % of the nominal fill (one of the two)']);
    expect(ta26(withLast({ minimumFill: { low: '5.0', unit: 'kg' }, minimumPercent: { low: '20', unit: '%' } }))).toEqual(['Set the minimum fill of the last container in kg or in % of the nominal fill (one of the two)']);
    expect(ta26(withLast({ minimumFill: { high: '26.0', unit: 'kg' } }))).toEqual(['The minimum fill needs a lower limit']);
    expect(ta26((p) => { withLast({ minimumFill: { low: '5.0', unit: 'kg' } })(p); withLast({ minimumFill: { low: '5.0', unit: 'kg' } })(p); }))
      .toEqual(['Pack and label has more than one part-filled last container step: keep one']);
  });

  it('a draft may be incomplete, but its shape is checked', () => {
    expect(masterSchema.safeParse({ ...api(), stages: [{ key: 'X Y' }] }).success).toBe(false);
  });

  it.each<[string, (d: MasterDoc) => void, string]>([
    ['weighing', (d) => { step(d, 'step1', 'weigh-ksm').checker = false; }, 'error TA-08 stages[1].steps[0]: A weighing step needs a second-person check'],
    ['charge-in', (d) => { step(d, 'step1', 'charge-ksm').checker = false; }, 'error TA-08 stages[1].steps[2]: A charge-in step needs a second-person check'],
    ['yield', (d) => { step(d, 'salt', 'yield').checker = false; }, 'error TA-08 stages[2].steps[1]: A yield step needs a second-person check'],
    ['critical', (d) => { step(d, 'step1', 'react').critical = true; }, 'error TA-08 stages[1].steps[3]: A critical step needs a second-person check'],
  ])('TA-08 a %s step without a second-person check is an error', (_what, change, want) => {
    expect(after(change)).toEqual([want]);
  });

  it('TA-10 a stage worked in a room without a line clearance step is an error; line clearance not first is a warning', () => {
    expect(after((d) => { d.stages[2]!.roomTypes = ['Step 2: salt formation']; })).toEqual(['error TA-10 stages[2]: Stage Step 2: salt formation is worked in a room but has no line clearance step']);
    const clearance = { key: 'line-clearance', block: { id: 'line-clearance', version: 1 }, checker: true, waitForCheck: false, critical: false, settings: {}, flow: { kind: 'none' as const } };
    expect(after((d) => { d.stages[2]!.roomTypes = ['Step 2: salt formation']; d.stages[2]!.steps.unshift(clearance); })).toEqual([]);
    expect(after((d) => { d.stages[2]!.steps.push(clearance); })).toEqual(['warning - stages[2].steps[2]: Line clearance is not the first step of Step 2: salt formation']);
    expect(after((d) => { d.stages[2]!.steps.unshift({ ...clearance, checker: false }); }))
      .toEqual(['error TA-08 stages[2].steps[0]: A line clearance step needs a second-person check']);
  });

  it('TA-01 an intermediate without a hold time is an error', () => {
    expect(after((d) => { delete d.stages[1]!.produces!.holdHours; })).toEqual(['error TA-01 stages[1].produces: The intermediate intermediate 1 has no hold time']);
  });

  it('a stage without a yield step is an error (a preparation needs none)', () => {
    expect(after((d) => { d.stages[2]!.steps.pop(); })).toEqual(['error - stages[2]: Stage Step 2: salt formation has no yield step']);
  });

  it('TA-01 the formula: each line in a stage, a quantity or equivalents, its molecular weight and density where needed, one starting material per stage', () => {
    expect(after((d) => { d.formula[2]!.stage = 'nowhere'; })).toEqual(['error TA-01 formula[2].stage: Sodium hydroxide is charged in no stage of this master']);
    expect(after((d) => { d.formula[1]!.quantity = '50.0'; })).toEqual(['error TA-01 formula[1]: Exampline: give its quantity or its equivalents (one of them)']);
    expect(after((d) => { delete d.formula[1]!.eq; })).toEqual(['error TA-01 formula[1]: Exampline: give its quantity or its equivalents (one of them)']);
    expect(errors((d) => { delete d.formula[1]!.mw; })).toEqual(['error TA-13 formula[1].mw: Exampline is charged by equivalents: give its molecular weight (g/mol)']);
    expect(errors((d) => { delete d.formula[5]!.density; })).toContain('error TA-13 formula[5].density: Hydrochloric acid 35 % is charged by equivalents as a volume: give its density (kg/L)');
    expect(errors((d) => { d.formula[1]!.role = 'starting material'; })).toEqual(['error TA-01 stages[1]: Stage Step 1: condensation has 2 starting materials: one is the key input of the stage; the others are reagents',
      'error TA-01 formula[1]: The starting material Exampline is the key input of its stage: give its quantity in kg']);
    // A quantity per kg in a stage with no key input (the base solution uses no intermediate and has no starting material).
    expect(after((d) => { d.formula[3]!.unit = 'L/kg'; })).toEqual([expect.stringMatching(/^error TA-13 formula\[3\]: Purified water is charged per kg or by equivalents of the key input, but its stage has no key input/)]);
    // The intermediate a later stage works on needs its molecular weight for equivalents.
    expect(errors((d) => { delete d.stages[1]!.produces!.mw; })).toEqual(expect.arrayContaining(['error TA-13 formula[5]: Hydrochloric acid 35 % is charged by equivalents of intermediate 1: give the molecular weight of intermediate 1']));
  });

  it('TA-13 adjustment settings the templates library refuses are errors (same basis, overage, salt factor)', () => {
    expect(errors((d) => {
      d.formula[0]!.adjust = { salt: { from: { name: 'base', mw: '383.4' }, to: { name: 'sodium sesquihydrate', mw: '432.4', hydrateOrSolvate: true } }, potency: { basis: 'anhydrous' } };
    })).toEqual([expect.stringMatching(/^error TA-13 formula\[0\]\.adjust: Same-basis rule \(C5\): the standard quantity already uses the hydrate/)]);
    expect(after((d) => { d.formula[0]!.adjust = { potency: { basis: 'as is' } }; }))
      .toEqual(['error TA-13 formula[0].adjust: Say whether the standard quantity is the anhydrous weight or the hydrate/solvate weight (same-basis rule C5)']);
    expect(after((d) => { d.formula[0]!.adjust = { overage: { percent: '5.0', maxPercent: '3.0' } }; }))
      .toEqual(['error TA-13 formula[0].adjust: The overage 5.0 % is above the 3.0 % the master allows']);
    expect(errors((d) => { d.formula[0]!.adjust = { salt: { from: { name: 'base', mw: '383.4' }, to: { name: 'hemifumarate', mw: '0' } } }; }))
      .toEqual(['error TA-13 formula[0].adjust: Molecular weights must be more than zero']);
  });

  it('a limit the library refuses is an error', () => {
    expect(after((d) => { step(d, 'step1', 'react').settings.temperatureLimit = { low: '85', high: '75', unit: '°C' }; }))
      .toEqual(['error - stages[1].steps[3].settings.temperatureLimit: The lower limit 85 is above the upper limit 75']);
  });

  it('TA-01 a limit or a typed target in a unit of another kind than the value it checks is an error (every reading would be refused)', () => {
    expect(errors((d) => { step(d, 'salt', 'crystallise').settings.temperatureLimit = { low: '0', high: '10', unit: 'min' }; }))
      .toEqual([expect.stringMatching(/^error TA-01 stages\[2\]\.steps\[0\]\.settings\.temperatureLimit: Temperature limits: min is a time, but the value checked is a temperature/)]);
    expect(errors((d) => { step(d, 'drying', 'qa-hold').settings = { what: 'Weight', unit: 'mg', limit: { low: '95', high: '105', unit: '%' } }; }))
      .toEqual(['error TA-01 stages[3].steps[1].settings.limit: Limits: % is a percentage, but the value checked is a mass. Choose a unit of that kind (in % every reading would be refused at batch time)']);
    expect(errors((d) => { step(d, 'step1', 'yield').settings.yieldLimit = { low: '97.0', high: '100.5', unit: 'kg' }; })).toHaveLength(1);
    expect(errors((d) => { step(d, 'step1', 'weigh-amine').settings.target = '12.0 min'; })).toEqual([expect.stringMatching(/^error TA-01 stages\[1\]\.steps\[1\]\.settings\.target: .*min is a time, but the value checked is a mass/)]);
    // A unit not in the list is refused as before; a unit of the same kind is not a kind problem.
    expect(errors((d) => { step(d, 'salt', 'crystallise').settings.temperatureLimit = { low: '0', high: '10', unit: 'F-min' }; })).toEqual([expect.stringMatching(/"F-min" is not in the unit list/)]);
    expect(errors((d) => { step(d, 'salt', 'crystallise').settings.temperatureLimit = { low: '273', high: '283', unit: 'K' }; })).toEqual([]);
    expect(errors((d) => { step(d, 'step1', 'weigh-amine').settings.target = '66.0 kg'; })).toEqual([]);
  });

  it('a limit of the wrong unit kind is refused at batch time too: C1 refuses the reading, nothing is compared', () => {
    const d = api();
    step(d, 'salt', 'crystallise').settings.temperatureLimit = { low: '0', high: '10', unit: 'min' };
    const r = evaluate(d, [], { stage: 2, sub: 1, step: 0, round: 1 }, { temperature: { value: '5', unit: '°C' } });
    expect(r.temperatureCheck).toMatchObject({ ok: false });
  });

  it('readings at an interval: a process to an end point needs its interval, at most every 480 minutes', () => {
    expect(after((d) => { step(d, 'salt', 'crystallise').everyMinutes = 600; }))
      .toEqual(['error TA-15 stages[2].steps[0].everyMinutes: Periodic checks every 600 min: they must be at least every 480 min']);
    expect(after((d) => { delete step(d, 'salt', 'crystallise').everyMinutes; }))
      .toEqual(['error TA-15 stages[2].steps[0].everyMinutes: Process to an end point needs the interval of its periodic checks']);
    expect(after((d) => { step(d, 'salt', 'crystallise').everyMinutes = 480; })).toEqual([]);
  });

  it('a repeat-until step without the most rounds, or without a stop check, is an error', () => {
    expect(after((d) => { step(d, 'step1', 'dry').flow = { kind: 'repeat-until' }; }))
      .toEqual(['error - stages[1].steps[4].flow: A repeat-until step needs the most rounds allowed']);
    expect(after((d) => { step(d, 'step1', 'dry').flow = { kind: 'repeat-until', maxRounds: 3, stop: 'nothing' }; }))
      .toEqual(['error - stages[1].steps[4].flow: A repeat-until step needs a stop check (a calculation of its block)']);
  });

  it('a reference to a field that does not exist, comes later, or is inside another sub-batch stage is an error', () => {
    const ref = (r: string) => after((d) => { step(d, 'salt', 'yield').settings.theoretical = { ref: r }; });
    expect(ref('step1/yield/nothing')).toEqual(['error - stages[2].steps[1].settings.theoretical: step1/yield/nothing: step yield has no field or calculation nothing']);
    expect(ref('drying/yield/output')).toEqual(['error - stages[2].steps[1].settings.theoretical: drying/yield/output comes later than this step']);
    expect(ref('nowhere/x/y')).toEqual(['error - stages[2].steps[1].settings.theoretical: nowhere/x/y: no such stage and step']);
    expect(ref('step1/yield/output')).toEqual([]);
  });

  it('unknown blocks, missing settings and stages used before they exist are errors; an unused preparation is a warning', () => {
    expect(after((d) => { step(d, 'step1', 'mill').block.version = 9; })).toEqual(['error - stages[1].steps[5].block: No block sieve version 9']);
    expect(after((d) => { delete step(d, 'step1', 'dry').settings.lodLimit; })).toEqual(['error - stages[1].steps[4].settings.lodLimit: LOD limit is not set']);
    expect(after((d) => { d.stages[1]!.uses = ['drying']; })).toEqual(['warning - stages[0]: No stage uses the preparation Base solution', 'error - stages[1].uses: drying is not an earlier stage']);
  });
});

// Calculation checks (owner decision of 15 November 2026): error-proofing of the calculations at master-building time.
// They are not GMP rules. Refusals are ⛔ errors; the warnings need an answer, kept in the master document.
describe('calculation checks', () => {
  type Change = (d: MasterDoc) => void;
  const salt = (to: { name: string; mw: string; moleculesPerUnit?: number; hydrateOrSolvate?: boolean }, extra: object = {}) =>
    (d: MasterDoc) => { d.formula[0]!.adjust = { salt: { from: { name: 'base', mw: '383.4' }, to }, ...extra }; };
  const only = (level: string, path: string) => (change: Change) => after(change).filter((p) => p.startsWith(`${level} `) && p.includes(` ${path}: `));

  it.each<[string, Change, Change, RegExp]>([
    ['water counted twice (hydrate MW and a water/LOD correction)',
      salt({ name: 'sodium sesquihydrate', mw: '432.4', hydrateOrSolvate: true }, { potency: { basis: 'anhydrous' } }),
      salt({ name: 'sodium', mw: '405.4' }, { potency: { basis: 'anhydrous' } }), /would count the water twice/],
    ['potency as parent with a salt factor',
      salt({ name: 'sodium', mw: '405.4' }, { potency: { basis: 'as is', potencyAs: 'parent' } }),
      (d) => { d.formula[0]!.adjust = { potency: { basis: 'as is', potencyAs: 'parent' } }; }, /factor is already inside it/],
    ['potency as element with a compound factor (calcium 40.08 to calcium carbonate 100.09: × 2.497)',
      (d) => { d.formula[0]!.adjust = { salt: { from: { name: 'calcium', mw: '40.08' }, to: { name: 'calcium carbonate', mw: '100.09' } }, potency: { basis: 'as is', potencyAs: 'element' } }; },
      (d) => { d.formula[0]!.adjust = { potency: { basis: 'as is', potencyAs: 'element' } }; }, /factor is already inside it/],
    ['molecules per salt unit ignored (a hemi-salt at 1 molecule per unit)',
      salt({ name: 'hemifumarate', mw: '883.1' }), salt({ name: 'hemifumarate', mw: '883.1', moleculesPerUnit: 2 }), /is a hemi-salt/],
    ['IU or CFU turned into a mass (a content per gram for a formula in mg)',
      (d) => { d.formula[0]!.adjust = { content: { formulaQuantityIs: 'dry', nominalContent: '5000 IU/g' } }; },
      (d) => { d.formula[0]!.adjust = { content: { formulaQuantityIs: 'dry', nominalContent: '98.0 %' } }; }, /must be in IU/],
  ])('calculation check ⛔ %s: shown on the formula line with a plain message', (_what, bad, fixed, message) => {
    const errors = only('error', 'formula[0].adjust');
    expect(errors(bad)).toEqual([expect.stringMatching(message)]);
    expect(errors(fixed)).toEqual([]);
  });

  const wet: Change = (d) => { d.formula[0]!.name = 'Examplol acid wet cake'; delete d.formula[0]!.adjust; };
  // 405.4 ÷ 383.4 = 1.0574: 1.10 is 4.0 % off, 1.060 is 0.2 % off
  const factor = (f: string): Change => (d) => { d.formula[0]!.adjust = { salt: { from: { name: 'base', mw: '383.4' }, to: { name: 'sodium', mw: '405.4' }, factor: f } }; };
  it.each<[string, Change, Change, string, string, string]>([
    ['solvent-wet starting material weighed as dry', wet, (d) => { d.formula[0]!.name = 'Examplol acid wet cake'; }, 'solvent-wet/ksm', 'formula[0]', 'weighed dry'],
    ['(e) salt factor differing from the molecular weights by more than 0.5 %', factor('1.10'), factor('1.060'), 'salt-factor/ksm', 'formula[0].adjust.salt', 'confirmed'],
  ])('calculation check ⚠️ %s: fires, passes, and once answered no longer blocks', (_what, fires, passes, key, path, choice) => {
    const d = api();
    fires(d);
    const q = checks(d).find((p) => p.question?.key === key)!;
    expect(q).toMatchObject({ level: 'warning', path, question: { options: expect.arrayContaining([choice]) } });
    expect(blocking(q)).toBe(true);
    // passes: the warning is not there
    const ok = api();
    passes(ok);
    expect(checks(ok).some((p) => p.question?.key === key)).toBe(false);
    // answered (with a reason where one is needed): shown as answered, not blocking
    d.answers = { [key]: { about: q.message, choice, reason: q.question!.needsReason ? 'Per the development report' : '' } };
    const answered = checks(d).find((p) => p.question?.key === key)!;
    expect(answered.question!.answer).toMatchObject({ choice });
    expect(blocking(answered)).toBe(false);
  });

  it('calculation check ⚠️ an answer counts only while it fits: a choice from the list, a reason where needed, the warning as answered', () => {
    const d = api();
    wet(d);
    const q = checks(d).find((p) => p.question?.key === 'solvent-wet/ksm')!;
    const answer = (a: object) => { d.answers = { 'solvent-wet/ksm': { about: q.message, choice: 'weighed dry', reason: 'Dried before dispensing', ...a } }; return checks(d).find((p) => p.question?.key === 'solvent-wet/ksm')!; };
    expect(blocking(answer({}))).toBe(false);
    expect(blocking(answer({ reason: ' ' }))).toBe(true);
    expect(blocking(answer({ choice: 'maybe' }))).toBe(true);
    expect(blocking(answer({ about: 'an older wording' }))).toBe(true);
  });
});

it('calculation check ⚠️ the messages say what to answer, in plain words', () => {
  const d = api();
  d.formula[0]!.adjust = { salt: { from: { name: 'base', mw: '383.4' }, to: { name: 'sodium', mw: '405.4' }, factor: '1.10' } };
  expect(checks(d).map((p) => `${p.path}: ${p.message}`)).toEqual([
    'formula[0].adjust.salt: The salt factor 1.10 written for Examplol acid differs by 4.0 % from the molecular weights of base and sodium (factor 1.0574), which the batch quantity uses. Confirm with a reason, or correct the factor or the molecular weights.',
  ]);
});
