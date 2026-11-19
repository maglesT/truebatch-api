import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import type { EventKind, Payload, StepEvent, StepKey } from '../shared/engine/index.js';

// An invented API, Examplone hydrochloride, 100 kg expected per batch, made in two steps: a base solution
// (preparation), step 1 condensation of the starting material (80.0 kg, MW 200.0 = 400 mol) with 1.10 eq of an amine,
// step 2 salt formation with 1.05 eq of hydrochloric acid as a volume, then drying and milling in two sub-batches.
// Step 1's molar theoretical yield: 400 mol × 330.0 g/mol = 132.000 kg of intermediate 1; 120.0 kg are expected.
export const api = (): MasterDoc => masterSchema.parse({
  header: { productItemId: 'prd-1', productCode: 'API-001', productName: 'Examplone hydrochloride', batchSize: '100.0', mw: '366.5', retestMonths: 36, dispensingRooms: ['DSP-01'] },
  formula: [
    { key: 'ksm', materialItemId: 'mat-ksm', code: 'MAT-001', name: 'Examplol acid', stage: 'step1', role: 'starting material', quantity: '80.0', unit: 'kg', mw: '200.0', adjust: { potency: { basis: 'dried', standardIs: 'anhydrous' } } },
    { key: 'amine', materialItemId: 'mat-amn', code: 'MAT-002', name: 'Exampline', stage: 'step1', role: 'reagent', eq: '1.10', mw: '150.0', adjust: { potency: { basis: 'as is', standardIs: 'anhydrous' } } },
    { key: 'naoh', materialItemId: 'mat-nao', code: 'MAT-003', name: 'Sodium hydroxide', stage: 'solution', role: 'reagent', quantity: '10.0', unit: 'kg' },
    { key: 'water', materialItemId: 'mat-wat', code: 'MAT-004', name: 'Purified water', stage: 'solution', role: 'solvent', quantity: '50.0', unit: 'L' },
    { key: 'toluene', materialItemId: 'mat-tol', code: 'MAT-005', name: 'Toluene', stage: 'step1', role: 'solvent', quantity: '5.0', unit: 'L/kg' },
    { key: 'hcl', materialItemId: 'mat-hcl', code: 'MAT-006', name: 'Hydrochloric acid 35 %', stage: 'salt', role: 'reagent', eq: '1.05', unit: 'L', mw: '36.46', density: '1.17' },
    { key: 'ipa', materialItemId: 'mat-ipa', code: 'MAT-007', name: 'Isopropyl alcohol', stage: 'salt', role: 'solvent', quantity: '4.0', unit: 'L/kg' },
  ],
  stages: [
    {
      key: 'solution', name: 'Base solution', kind: 'preparation', machineTypes: ['balance', 'stirrer'], role: 'Production operator',
      produces: { name: 'base solution', holdHours: 24 },
      steps: [
        { key: 'weigh-naoh', block: { id: 'weigh', version: 1 }, checker: true, settings: { target: { formula: 'naoh' }, tolerance: '0.5' } },
        { key: 'stir', block: { id: 'mix', version: 1 }, checker: false, minMinutes: 10 },
      ],
    },
    {
      key: 'step1', name: 'Step 1: condensation', kind: 'normal', machineTypes: ['balance', 'reactor', 'dryer', 'mill'], uses: ['solution'], role: 'Production operator',
      produces: { name: 'intermediate 1', holdHours: 72, mw: '330.0', expectedKg: '120.0' },
      steps: [
        { key: 'weigh-ksm', block: { id: 'weigh', version: 1 }, checker: true, critical: true, settings: { target: { formula: 'ksm', adjusted: true }, tolerance: '0.5' } },
        { key: 'weigh-amine', block: { id: 'weigh', version: 1 }, checker: true, settings: { target: { formula: 'amine', adjusted: true }, tolerance: '0.5' } },
        { key: 'charge-ksm', block: { id: 'charge', version: 1 }, checker: true, settings: { material: { formula: 'ksm' } } },
        { key: 'react', block: { id: 'react', version: 1 }, checker: false, everyMinutes: 60, flow: { kind: 'repeat-until', maxRounds: 10 },
          settings: { temperatureLimit: { low: '75', high: '85', unit: '°C' }, ipcUnit: '%', ipcLimit: { high: '1.0', unit: '%' } } },
        { key: 'dry', block: { id: 'dry', version: 1 }, checker: false, flow: { kind: 'repeat-until', maxRounds: 5 }, settings: { lodLimit: { high: '2.0', unit: '%' } } },
        { key: 'mill', block: { id: 'sieve', version: 1 }, checker: true },
        { key: 'yield', block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: { molar: true }, yieldLimit: { low: '85.0', high: '100.5', unit: '%' }, accountabilityLimit: { low: '99.0', high: '100.5', unit: '%' } } },
      ],
    },
    {
      key: 'salt', name: 'Step 2: salt formation', kind: 'normal', machineTypes: ['reactor'], uses: ['step1'], role: 'Production operator',
      produces: { name: 'wet API', holdHours: 720 },
      steps: [
        { key: 'crystallise', block: { id: 'react', version: 1 }, checker: false, everyMinutes: 30, flow: { kind: 'repeat-until', maxRounds: 40 },
          settings: { temperatureLimit: { low: '0', high: '10', unit: '°C' }, ipcUnit: 'pH', ipcLimit: { low: '1.5', high: '2.5', unit: 'pH' } } },
        { key: 'yield', block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: { header: 'batchSize' }, yieldLimit: { low: '97.0', high: '100.5', unit: '%' }, accountabilityLimit: { low: '99.0', high: '100.5', unit: '%' } } },
      ],
    },
    {
      key: 'drying', name: 'Drying', kind: 'sub-batch', count: 2, machineTypes: ['dryer'], uses: ['salt'], role: 'Production operator',
      produces: { name: 'dried API', holdHours: 2160 },
      steps: [
        { key: 'dry', block: { id: 'dry', version: 1 }, checker: false, flow: { kind: 'repeat-until', maxRounds: 10 }, settings: { lodLimit: { high: '0.5', unit: '%' } } },
        { key: 'qa-hold', block: { id: 'check', version: 1 }, checker: false, flow: { kind: 'qa-hold' }, settings: { what: 'Appearance score', unit: '', limit: { low: '4', unit: '' } } },
        { key: 'yield', block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '50.000 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' }, accountabilityLimit: { low: '99.0', high: '100.5', unit: '%' } } },
      ],
    },
  ],
});

/**
 * The fixture as a master names where its stages run (TA-10, TA-11): each stage allows the rooms of its own name as
 * an area, and starts with line clearance. Most tests leave this out: their checks are filtered by `unplaced`.
 */
export function placed(doc: MasterDoc): MasterDoc {
  const clearance = { key: 'clearance', block: { id: 'line-clearance', version: 1 }, settings: {}, checker: true, waitForCheck: false, critical: false, flow: { kind: 'none' as const } };
  return { ...doc, stages: doc.stages.map((s) => ({ ...s, roomTypes: s.roomTypes.length ? s.roomTypes : [s.name],
    steps: s.steps.some((t) => t.block.id === 'line-clearance') ? s.steps : [clearance, ...s.steps] })) };
}
/** Leaves out the problems of stages that name no rooms (TA-11, tested in master-checks.test.ts). */
export const unplaced = <T extends { rule?: string; path: string }>(problems: T[]) => problems.filter((p) => !(p.rule === 'TA-11' && p.path.endsWith('.roomTypes')) && (p as { level?: string }).level !== 'info');
// (Tablets round 45: an info line, never blocking, is left out too: the fixture has a reaction in two stages.)

/** A small master with the given stages; each step defaults to a "check a value" step without a checker. */
export function small(stages: object[]): MasterDoc {
  return masterSchema.parse({
    header: { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '100.0', retestMonths: 24, dispensingRooms: ['DSP-01'] },
    formula: [{ key: 'x', materialItemId: 'm', code: 'M', name: 'M', stage: 's0', role: 'reagent', quantity: '100.0', unit: 'kg' }],
    stages: stages.map((s, i) => ({ key: `s${i}`, name: `Stage ${i}`, kind: 'normal', ...s,
      steps: ((s as { steps?: object[] }).steps ?? [{}]).map((t, j) => ({ key: `t${j}`, block: { id: 'check', version: 1 }, checker: false,
        settings: { what: 'pH', unit: '', limit: { low: '5.0', high: '7.0', unit: '' } }, ...t })) })),
  });
}

export const T0 = new Date('2026-11-15T08:00:00Z');
export const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/** An event list builder: ev('done', '0.1.0.1', { person: 2, min: 5 }). */
let next = 1;
export function ev(kind: EventKind, key: string, o: { person?: number | null; min?: number; payload?: Payload } = {}): StepEvent {
  const [stage, sub, step, round] = key.split('.').map(Number) as [number, number, number, number];
  const k: StepKey = { stage, sub, step, round };
  return { id: next++, ...k, kind, payload: o.payload ?? {}, person: o.person === undefined ? 1 : o.person, at: at(o.min ?? next) };
}
/** A value event whose results are those of the engine for these values. */
export const reading = (key: string, results: Record<string, unknown>, o: { person?: number; min?: number } = {}) =>
  ev('value', key, { ...o, payload: { values: {}, results: results as Payload['results'] } });
export const pass = { ok: true, value: '1', unit: '', shown: '', check: { pass: true, level: 'pass', shown: '' } };
export const fail = { ok: true, value: '9', unit: '', shown: '', check: { pass: false, level: 'fail', shown: '' } };
