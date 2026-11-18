import { describe, expect, it } from 'vitest';
import { BLOCKS, findBlock } from '../shared/blocks/index.js';
import { blocking, masterChecks } from '../shared/master/checks.js';
import { masterSchema } from '../shared/master/schema.js';
import { stepTitle } from '../shared/engine/batch.js';
import { describeMaster, diffMasters, stepText } from '../web/src/designer/describe.js';
import { dispensing, workedExample } from '../web/src/designer/example.js';
import { answerDoc, earlierRefs, neededKind, scaleDoc, stepFrom } from '../web/src/designer/model.js';
import { sentence, sentenceText } from '../web/src/designer/sentences.js';
import { SKELETON_LIST, skeletonStages } from '../web/src/designer/skeletons.js';
import { api, unplaced } from './engine-fixture.js';

// The designer's pure parts: sentences instead of formulas, inputs offered by kind, worked examples and the
// calculation preview through the engine, skeletons, copying to a new batch size, and the changes view.

const block = (id: string) => BLOCKS.find((b) => b.id === id)!;

describe('master designer', () => {
  it('every calculation of the block library reads as a sentence, never a formula', () => {
    for (const b of BLOCKS) for (const c of b.calcs) {
      const words = sentence(b, c).filter((p) => typeof p === 'string').join('');
      expect(words, `${b.id}.${c.name}`).not.toMatch(/[×÷=]|\$|T\d|C\d/);
    }
    const d = api();
    const weigh = d.stages[1]!.steps[0]!;
    expect(sentenceText(d, block('weigh'), weigh.settings, sentence(block('weigh'), block('weigh').calcs[1]!)))
      .toBe('The net weight must be within ± 0.5 % of the batch quantity of Examplol acid, adjusted for the lot.');
  });

  it('every block reads in words with its default settings: a limit written in the block too, never [object Object]', () => {
    const d = api();
    for (const b of BLOCKS) {
      const t = stepFrom(b, []);
      const text = [stepText(d, t, 0), ...b.calcs.map((c) => sentenceText(d, b, t.settings, sentence(b, c)))].join(' ');
      expect(text, `${b.id} v${b.version}`).not.toMatch(/\[object Object\]|undefined|NaN/);
    }
    // Any shape written into a block reads in words too.
    const ch = block('check');
    const said = (limit: unknown) => sentenceText(d, ch, {}, sentence(ch, { name: 'x', label: 'x', template: 'C1', args: { value: '$reading', limit } }));
    expect(said({ max: 0 })).toBe('The reading must be at most 0.');
    expect(said({ low: '2', high: '5', unit: 'kg' })).toBe('The reading must be within 2 to 5 kg.');
  });

  it('a quantity or limit is offered only from values of a compatible kind', () => {
    expect(neededKind(block('stage-yield'), 'theoretical')).toBe('mass');
    expect(neededKind(block('stage-yield'), 'yieldLimit')).toBe('fraction');
    expect(neededKind(block('react'), 'temperatureLimit')).toBe('temperature');
    // A limit on a result whose template sets its kind: not the kind of the values it is worked out from.
    expect(['finesLimit', 'recoveryLimit'].map((n) => neededKind(BLOCKS.find((b) => b.settings.some((x) => x.name === n))!, n))).toEqual(['fraction', 'fraction']);
    const masses = earlierRefs(api(), 2, 1).filter((r) => r.kind === 'mass').map((r) => r.ref);
    expect(masses).toContain('step1/yield/output');
    expect(masses).not.toContain('step1/yield/yield');
    // A later step, or a step inside another sub-batch stage, is never offered.
    expect(earlierRefs(api(), 2, 0).map((r) => r.ref).some((r) => r.startsWith('salt/') || r.startsWith('drying/'))).toBe(false);
  });

  it('worked examples run the engine on example values: the weighing meets its adjusted target, the yield is in limits', () => {
    const d = api();
    const ksm = workedExample(d, 1, 0);
    expect(ksm.results.target).toMatchObject({ ok: true, shown: expect.stringContaining('80.000 kg × 100 ÷ 98.505 % = 81.214 kg') });
    expect(ksm.results.netCheck).toMatchObject({ ok: true, check: { pass: true } });
    expect(workedExample(d, 1, 6).results.theoretical).toMatchObject({ ok: true, value: '132' });
    expect(workedExample(d, 2, 1, { output: { value: '20.000', unit: 'kg' } }).results.yield).toMatchObject({ ok: true, check: { pass: false } });
  });

  it('TA-13 the calculation preview adjusts each line for the lot: the starting material for its assay and LOD', () => {
    const rows = dispensing(api(), { ksm: { assay: '98.0', lod: '2.0' }, amine: { assay: '100.0' } });
    // 80.000 kg × 100 ÷ (98.0 × 98.0 ÷ 100) = 83.29862 kg
    expect(rows[0]!.adjusted).toMatchObject({ ok: true, value: expect.stringMatching(/^83\.2986/) });
    expect(rows[1]!.adjusted).toMatchObject({ ok: true, value: '66' });
    expect(rows[2]!.adjusted).toBeUndefined();
  });

  it('TA-10 the process skeletons are valid drafts and start every stage with line clearance; what they leave open is listed by the master check', () => {
    const header = { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '100.0', retestMonths: 36, dispensingRooms: ['RM-101'] };
    for (const s of SKELETON_LIST) {
      const doc = masterSchema.parse({ header, formula: [], stages: skeletonStages(s.id, header) });
      expect(doc.stages.every((st) => st.steps.every((t) => findBlock(t.block)) && st.steps[0]!.block.id === 'line-clearance')).toBe(true);
      expect(masterChecks(doc).filter((p) => !/not set|not checked|no materials|choose the rooms|no key input/.test(p.message)), s.id).toEqual([]);
      // Pack and label is the last stage of every skeleton (owner, 18 Nov 2026), with the drums filled one by one.
      expect(doc.stages.at(-1)!.name).toBe('Pack and label');
      expect(doc.stages.at(-1)!.steps.map((t) => t.block.id)).toEqual(['line-clearance', 'container-issue', 'pack-material-issue', 'container-fill', 'qa-sample', 'qa-sample',
        'container-return', 'printed-reconciliation', 'destruction', 'stage-yield']);
    }
    // TA-11: a master that weighs names its dispensing rooms; a new one starts with none (the author picks them).
    const bare = masterSchema.parse({ header: { ...header, dispensingRooms: undefined }, formula: [], stages: skeletonStages(SKELETON_LIST[0]!.id, header) });
    expect(masterChecks(bare).filter((p) => p.path === 'header.dispensingRooms')).toEqual([{ level: 'error', path: 'header.dispensingRooms', rule: 'TA-11',
      message: 'The master weighs but names no dispensing rooms: choose them in the header (rooms of master data)' }]);
    const blend = skeletonStages('blending', header);
    expect(blend[0]!.steps.map((t) => t.block.id).join(' ')).toBe('line-clearance weigh charge mix qa-sample stage-yield');
    // Three steps: each makes its intermediate, used by the next; the reactions and distillations read at intervals.
    const three = skeletonStages('three-step', header);
    expect(three.map((s) => [s.key, s.uses.join(), s.produces?.name ?? ''])).toEqual([['step1', '', 'intermediate 1'], ['step2', 'step1', 'intermediate 2'],
      ['step3', 'step2', 'API, unpacked'], ['pack', '', '']]);
    expect(three[0]!.steps.find((t) => t.key === 'react')).toMatchObject({ everyMinutes: 60, flow: { kind: 'repeat-until', maxRounds: 50 } });
    expect(three[2]!.steps.find((t) => t.key === 'yield')!.settings.theoretical).toEqual({ molar: true });
    expect(blend[1]!.steps.at(-1)!.settings.theoretical).toEqual({ ref: 'blending/yield/output' });
    expect(blend[1]!.steps.find((t) => t.key === 'label-reconciliation')!.settings.issued).toEqual({ ref: 'pack/labels/issued' });
  });

  it('a weigh step added from the library starts with the usual tolerance', () => {
    expect(stepFrom(block('weigh'), []).settings).toEqual({ tolerance: '0.5' });
    expect(stepFrom(block('sieve'), []).settings).toEqual({});
  });

  it('copy to a new batch size scales quantities per batch, not limits, equivalents or quantities per kg of a key input', () => {
    const d = scaleDoc(api(), '50.0');
    expect(d.header.batchSize).toBe('50.0');
    expect(d.formula.map((l) => l.quantity ?? `${l.eq} eq`)).toEqual(['40.0', '1.10 eq', '5.0', '25.0', '5.0', '1.05 eq', '4.0']);
    expect(d.stages[1]!.produces!.expectedKg).toBe('60.0');
    expect(d.stages[3]!.steps[2]!.settings.theoretical).toBe('25.000 kg');
    expect(d.stages[1]!.steps[6]!.settings.yieldLimit).toEqual({ low: '85.0', high: '100.5', unit: '%' });
  });

  it('the changes view shows what changed, was added or removed since the previous version', () => {
    const prev = api();
    const next = api();
    next.formula[4]!.quantity = '6.0';
    next.stages[2]!.steps.pop();
    next.stages[1]!.produces!.holdHours = 48;
    const diff = diffMasters(prev, next);
    const lines = diff.flatMap((s) => s.lines.filter((l) => l.change !== 'same').map((l) => `${s.title} ${l.key} ${l.change}`));
    expect(lines).toEqual(['Formula toluene changed', 'Stage 2: Step 1: condensation about changed', 'Stage 3: Step 2: salt formation yield removed']);
    expect(describeMaster(prev).map((s) => s.title)).toEqual(['Header', 'Formula', 'Stage 1: Base solution', 'Stage 2: Step 1: condensation', 'Stage 3: Step 2: salt formation', 'Stage 4: Drying']);
  });

  it('calculation checks: the author answers a warning; the answer is kept in the master and shown in the review and changes views', () => {
    const prev = api();
    prev.formula[0]!.name = 'Examplol acid wet cake';
    delete prev.formula[0]!.adjust;
    const warning = masterChecks(prev).find((p) => p.question?.key === 'solvent-wet/ksm')!;
    expect(blocking(warning)).toBe(true);
    expect(describeMaster(prev).at(-1)).toMatchObject({ title: 'Calculation checks', lines: [{ text: expect.stringMatching(/Not answered yet\.$/) }] });
    const next = answerDoc(prev, warning, 'weighed dry', 'Dried to constant weight before dispensing');
    expect(next.answers).toEqual({ 'solvent-wet/ksm': { about: warning.message, choice: 'weighed dry', reason: 'Dried to constant weight before dispensing' } });
    expect(masterSchema.parse(next).answers).toEqual(next.answers);
    expect(unplaced(masterChecks(next).filter(blocking))).toEqual([]);
    const line = describeMaster(next).at(-1)!.lines[0]!.text;
    expect(line).toMatch(/^Formula › Examplol acid wet cake: .* Answered: weighed dry\. Reason: Dried to constant weight before dispensing\.$/);
    expect(diffMasters(prev, next).flatMap((s) => s.lines.filter((l) => l.change !== 'same').map((l) => `${s.title} ${l.change}: ${l.text}`))).toEqual([`Calculation checks changed: ${line}`]);
    // A changed item asks again: the answer was for the warning as it read then.
    const changed = { ...next, formula: next.formula.map((l, i) => (i === 0 ? { ...l, name: 'Examplol acid damp cake' } : l)) };
    expect(masterChecks(changed).find((p) => p.question?.key === 'solvent-wet/ksm')?.question?.answer).toBeUndefined();
  });
});
