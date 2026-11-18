// Process skeletons a new master may start from (plan section 4): the usual stages and steps of an API process, as
// data. Settings that depend on the product (which material a step weighs, its limits) are left for the author; the
// master check lists them. Every stage is worked in a room, so each starts with line clearance (TA-10). Pack and label
// is the last stage of every skeleton (owner, 18 Nov 2026); its yield is on the output of the stage before it. A stage
// starts with the rooms it usually runs in, by the usual area names; the master check asks for the rest (TA-11).
import { findBlock } from '../../../shared/blocks/index.js';
import type { MasterDoc, SettingValue, Stage, Step } from '../../../shared/master/schema.js';
import { stepFrom } from './model.js';

type Header = MasterDoc['header'];
interface StepPlan { block: string; key?: string; name?: string; checker?: boolean; settings?: (h: Header) => Record<string, SettingValue>; minMinutes?: number }
interface StagePlan { key: string; name: string; kind?: Stage['kind']; role: string; rooms?: string[]; produces?: [string, number]; uses?: string[]; steps: StepPlan[] }

const yieldStep = (theoretical: SettingValue, low = '90.0'): StepPlan => ({ block: 'stage-yield', key: 'yield', settings: () => ({
  theoretical, yieldLimit: { low, high: '100.5', unit: '%' }, accountabilityLimit: { low: '99.0', high: '100.5', unit: '%' } }) });
const sample = (key: string, name: string): StepPlan => ({ block: 'qa-sample', key, name });
const step = (block: string, key: string, name?: string): StepPlan => ({ block, key, ...(name ? { name } : {}) });

/** Pack and label (TA-26): drums issued, labels issued, each drum filled and labelled, samples, what is left counted back, labels reconciled, leftovers destroyed, yield. */
const packAndLabel = (before: string): StagePlan => ({
  key: 'pack', name: 'Pack and label', role: 'Packing operator', rooms: ['Packing'],
  steps: [step('container-issue', 'drums', 'Issue the drums'), { block: 'pack-material-issue', key: 'labels', name: 'Issue the labels', settings: () => ({ unit: 'units' }) },
    step('container-fill', 'fill', 'Fill and label the drums'), sample('qc-sample', 'QC sample'), sample('reserve-sample', 'Reserve sample'),
    step('container-return', 'drums-back', 'Count back the drums'),
    { block: 'printed-reconciliation', key: 'label-reconciliation', name: 'Reconcile the labels', settings: () => ({ unit: 'units', issued: { ref: 'pack/labels/issued' } }) },
    { block: 'destruction' }, yieldStep({ ref: `${before}/yield/output` }, '99.0')],
});

// The finishing steps of the stage that makes the API: crystallise, isolate, dry, mill.
const finish = [step('react', 'crystallise', 'Crystallise'), step('isolate', 'isolate'), step('dry', 'dry'), step('sieve', 'mill', 'Mill')];
const reaction = (n: number, uses: string[], more: StepPlan[], produces?: [string, number]): StagePlan => ({
  key: `step${n}`, name: `Step ${n}`, role: 'Production operator', rooms: ['Reaction'], uses, ...(produces ? { produces } : {}),
  steps: [step('weigh', 'weigh'), step('charge', 'charge'), step('charge-liquid', 'solvent', 'Charge the solvent'), step('react', 'react', 'React'), ...more, yieldStep({ molar: true })],
});

const SKELETONS: { id: string; name: string; text: string; stages: StagePlan[] }[] = [
  {
    id: 'three-step', name: 'Multi-step synthesis with crystallisation (3 steps)',
    text: 'Step 1 and step 2 make intermediates (react, work-up, distil; step 2 isolates and dries), step 3 makes the API (react, crystallise, isolate, dry, mill); then Pack and label. Add or remove steps as the route needs.',
    stages: [
      reaction(1, [], [step('separate', 'separate'), step('distil', 'distil')], ['intermediate 1', 72]),
      reaction(2, ['step1'], [step('separate', 'separate'), step('isolate', 'isolate'), step('dry', 'dry')], ['intermediate 2', 720]),
      reaction(3, ['step2'], finish.slice(), ['API, unpacked', 720]),
      packAndLabel('step3'),
    ],
  },
  {
    id: 'salt', name: 'Single-step salt formation',
    text: 'Dissolve the base, add the acid, crystallise, isolate, dry, mill; then Pack and label.',
    stages: [
      { key: 'salt', name: 'Salt formation', role: 'Production operator', rooms: ['Reaction'], produces: ['API, unpacked', 720],
        steps: [step('charge-liquid', 'solvent', 'Charge the solvent'), step('weigh', 'weigh', 'Weigh the base'), step('charge', 'charge', 'Charge the base'), step('mix', 'dissolve', 'Dissolve'),
          step('charge-liquid', 'acid', 'Add the acid'), ...finish, yieldStep({ molar: true })] },
      packAndLabel('salt'),
    ],
  },
  {
    id: 'recrystallisation', name: 'Recrystallisation or reprocessing',
    text: 'Dissolve, carbon treatment, filter (filtrate kept), crystallise, isolate, dry, mill; then Pack and label. Also the master for reprocessing a batch (TA-19).',
    stages: [
      { key: 'recrystallisation', name: 'Recrystallisation', role: 'Production operator', rooms: ['Reaction'], produces: ['API, unpacked', 720],
        steps: [step('charge-liquid', 'solvent', 'Charge the solvent'), step('weigh', 'weigh', 'Weigh the crude'), step('charge', 'charge', 'Charge the crude'), step('mix', 'dissolve', 'Dissolve'),
          step('weigh', 'weigh-carbon', 'Weigh the carbon'), step('charge', 'charge-carbon', 'Charge the carbon'), step('mix', 'carbon', 'Carbon treatment'),
          step('filter-keep', 'filter', 'Filter off the carbon'), ...finish, yieldStep('')] },
      packAndLabel('recrystallisation'),
    ],
  },
  {
    id: 'blending', name: 'Blending of released batches',
    text: 'Weigh each released API lot, blend, sample, yield; then Pack and label. The retest date comes from the oldest lot (TA-25).',
    stages: [
      { key: 'blending', name: 'Blending', role: 'Production operator', rooms: ['Blending'], produces: ['blended API', 720],
        steps: [{ block: 'weigh', key: 'weigh-lots' }, { block: 'charge', key: 'charge-lots' }, { block: 'mix', key: 'blend' },
          sample('blend-sample', 'Blend sample'), yieldStep({ header: 'batchSize' }, '98.0')] },
      packAndLabel('blending'),
    ],
  },
];
export const SKELETON_LIST = SKELETONS.map(({ id, name, text }) => ({ id, name, text }));

/** The stages of a skeleton for this header. */
export function skeletonStages(id: string, h: Header): Stage[] {
  const sk = SKELETONS.find((s) => s.id === id);
  if (!sk) return [];
  return sk.stages.map((p) => ({
    key: p.key, name: p.name, kind: p.kind ?? 'normal', roomTypes: p.rooms ?? [], machineTypes: [], role: p.role, uses: p.uses ?? [],
    ...(p.produces ? { produces: { name: p.produces[0], holdHours: p.produces[1] } } : {}),
    steps: [{ block: 'line-clearance' }, ...p.steps].reduce<Step[]>((steps, sp) => {
      const block = findBlock({ id: sp.block, version: 1 })!;
      const base = stepFrom(block, steps.map((t) => t.key));
      const settings = Object.fromEntries(Object.entries({ ...base.settings, ...sp.settings?.(h) }).filter(([, v]) => v !== ''));
      // A block that repeats (rounds until its stop check) starts with 50 rounds at most; readings at intervals every 60 min.
      const rounds = block.stop ? { flow: { kind: 'repeat-until' as const, maxRounds: 50 }, ...(block.periodic ? { everyMinutes: 60 } : {}) } : {};
      return [...steps, { ...base, ...rounds, ...(sp.key ? { key: sp.key } : {}), ...(sp.name ? { name: sp.name } : {}), settings,
        ...(sp.checker ? { checker: true } : {}), ...(sp.minMinutes ? { minMinutes: sp.minMinutes } : {}) }];
    }, []),
  }));
}

