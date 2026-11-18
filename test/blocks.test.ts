import { describe, expect, it } from 'vitest';
import { findBlock } from '../shared/blocks/index.js';
import { blockProblems } from '../shared/blocks/format.js';
import { doneProblems, evaluate, materialUses, openSteps, parseKey, type StepEvent, type Value } from '../shared/engine/index.js';
import { readValue } from '../shared/engine/values.js';
import { masterChecks } from '../shared/master/checks.js';
import type { MasterDoc } from '../shared/master/schema.js';
import { at, ev, small, unplaced } from './engine-fixture.js';
// The problems, without the rooms a stage must name (TA-11): the fixtures name none.
const checks = (d: Parameters<typeof masterChecks>[0]) => unplaced(masterChecks(d));

// The API block library: each block is a description that the format accepts and that a small master can use without
// a master-check problem; the engine runs them like any other block.

const pct = (low: string, high: string) => ({ low, high, unit: '%' });
const yieldStep = { key: 'yield', block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '100.0 kg', yieldLimit: pct('97.0', '100.5') } };
const reaction = { temperatureLimit: { low: '75', high: '85', unit: '°C' }, ipcUnit: '%', ipcLimit: { high: '1.0', unit: '%' } };

// Each block with the settings a small master gives it (and its step options).
const NEW: [string, Record<string, unknown>, object?][] = [
  ['weigh', { target: { formula: 'x' }, tolerance: '0.5' }],
  ['charge', { material: { formula: 'x' } }],
  ['mix', {}],
  ['react', reaction, { everyMinutes: 60, flow: { kind: 'repeat-until', maxRounds: 10 } }],
  ['charge-liquid', { target: { formula: 'x' }, unit: 'kg', tolerance: '1.0' }],
  ['separate', { keptLayer: 'lower' }, { minMinutes: 30 }],
  ['distil', { temperatureLimit: { low: '40', high: '60', unit: '°C' }, volumeLimit: { high: '200', unit: 'L' } }, { everyMinutes: 30, flow: { kind: 'repeat-until', maxRounds: 40 } }],
  ['distil-dry', { temperatureLimit: { low: '40', high: '60', unit: '°C' } }, { everyMinutes: 30, flow: { kind: 'repeat-until', maxRounds: 40 } }],
  ['filter-keep', {}],
  ['column', { eluent: { formula: 'x' }, resultUnit: '%', resultLimit: { low: '95', unit: '%' } }, { flow: { kind: 'repeat-until', maxRounds: 50 } }],
  ['isolate', { washTarget: '50 L', tolerance: '5' }, { flow: { kind: 'repeat-until', maxRounds: 20 } }],
  ['dry', { lodLimit: { high: '0.5', unit: '%' } }, { flow: { kind: 'repeat-until', maxRounds: 10 } }],
  ['sieve', {}],
  ['sub-batch-combine', { accountabilityLimit: pct('99.0', '100.5') }],
  ['sieve-analysis', { sieve1: '850 µm', sieve2: '425 µm', sieve3: '250 µm', sieve4: '180 µm', sieve5: '150 µm', finesBelow: '150 µm', finesLimit: { high: '20.0', unit: '%' } }],
  ['qa-sample', { sampleLimit: { low: '50', high: '60', unit: 'g' } }, { flow: { kind: 'qa-hold' } }],
  ['container-issue', { material: { formula: 'x' }, expected: '4 units' }],
  ['pack-material-issue', { material: { formula: 'x' }, unit: 'units' }],
  ['container-fill', { nominal: '25.0 kg', tolerance: '0.5' }, { flow: { kind: 'repeat-until', maxRounds: 50 } }],
  ['container-return', { material: { formula: 'x' } }],
  ['printed-reconciliation', { material: { formula: 'x' }, unit: 'units', issued: '100 units' }],
  ['destruction', {}],
];
const using = (id: string, settings: object, options: object = {}): MasterDoc => {
  const b = findBlock({ id, version: 1 })!;
  const step = { key: id, block: { id, version: 1 }, checker: b.checker, settings, ...options };
  return small([{ role: 'Production operator', steps: b.gmp === 'yield' ? [step] : [step, yieldStep] }]);
};

describe('the API blocks', () => {
  it.each(NEW)('the %s block is a valid description, and a small master using it passes the master check', (id, settings, options) => {
    expect(blockProblems(findBlock({ id, version: 1 })!)).toEqual([]);
    // A packing step alone is not a Pack and label stage (TA-26, tested in master-checks.test.ts).
    expect(checks(using(id, settings, options)).filter((p) => p.rule !== 'TA-26').map((p) => `${p.path}: ${p.message}`)).toEqual([]);
  });

  it('an overage may be set on any line (T16): 100 kg with 10 % is 110 kg', () => {
    const doc = using('weigh', { target: { formula: 'x', adjusted: true }, tolerance: '0.5' });
    doc.formula[0]!.adjust = { overage: { percent: '10' } };
    expect(evaluate(doc, [], { stage: 0, sub: 1, step: 0, round: 1 }, {}).target).toMatchObject({ ok: true, value: '110', unit: 'kg' });
    expect(checks(doc).map((p) => p.message)).toEqual([]);
  });
});

/** Records a step's values (results from the engine) and signs it done, checked by a second person when it needs it. */
function walk(doc: MasterDoc, events: StepEvent[], key: string, values: Record<string, Value>): StepEvent[] {
  const k = parseKey(key)!;
  const uses: number[] = [];
  const results = evaluate(doc, events, k, values, uses);
  const recorded = [...events, ev('started', key), ev('value', key, { payload: { values, results, uses } })];
  const view = openSteps(doc, recorded, at(10_000)).steps.find((s) => s.id === key)!;
  expect(doneProblems(doc, view, at(10_000)), key).toEqual([]);
  const done = [...recorded, ev('done', key)];
  return doc.stages[k.stage]!.steps[k.step]!.checker ? [...done, ev('checked', key, { person: 2 })] : done;
}
const kg = (value: string) => ({ value, unit: 'kg' });
const n = (value: string, unit: string, count: number) => Array.from({ length: count }, () => ({ value, unit }));

describe('the engine runs the new blocks like any other', () => {
  const state = (doc: MasterDoc, events: StepEvent[], id: string) => openSteps(doc, events, at(10_000)).steps.find((x) => x.id === id)?.state ?? 'absent';

  it('TA-14 a reaction goes on in rounds until the IPC is within its end point: "not complete, continue" is no deviation', () => {
    const doc = using('react', reaction, NEW[3]![2]);
    const round = (ipc: string) => ({ machine: { itemId: 'r1', code: 'RCT-01', name: 'Reactor', version: 1, type: 'reactor', room: 'RM-1', area: 'Area' },
      temperature: { value: '80', unit: '°C' }, ipcMethod: 'HPLC', ipcResult: { value: ipc, unit: '%' }, ipcReport: 'IPC-1' });
    const r1 = walk(doc, [], '0.1.0.1', round('3.2'));
    expect(openSteps(doc, r1, at(10_000)).steps.find((x) => x.id === '0.1.0.1')!.results.ipcCheck).toMatchObject({ ok: true, check: { pass: false } });
    expect(state(doc, r1, '0.1.1.1')).toBe('waiting');
    const r2 = walk(doc, r1, '0.1.0.2', round('0.8'));
    expect(state(doc, r2, '0.1.0.3')).toBe('absent');
    expect(state(doc, r2, '0.1.1.1')).toBe('open');
  });

  it('TA-14 a TLC end point: the master makes "End point seen" the stop check', () => {
    const doc = using('react', { temperatureLimit: reaction.temperatureLimit }, { everyMinutes: 60, flow: { kind: 'repeat-until', maxRounds: 10, stop: 'endPoint' } });
    expect(checks(doc).map((p) => p.message)).toEqual([]);
    const base = { machine: { itemId: 'r1', code: 'RCT-01', name: 'Reactor', version: 1, type: 'reactor', room: 'RM-1', area: 'Area' }, temperature: { value: '80', unit: '°C' }, ipcMethod: 'TLC' };
    const r1 = walk(doc, [], '0.1.0.1', { ...base, endPointSeen: 'no' });
    expect(state(doc, r1, '0.1.1.1')).toBe('waiting');
    const r2 = walk(doc, r1, '0.1.0.2', { ...base, endPointSeen: 'yes' });
    expect(state(doc, r2, '0.1.1.1')).toBe('open');
  });

  it('TA-26 containers filled in rounds until the last: the net of each within ± tolerance of the nominal fill', () => {
    const doc = using('container-fill', { nominal: '25.0 kg', tolerance: '0.5' }, { flow: { kind: 'repeat-until', maxRounds: 50 } });
    const bal = { itemId: 'b', code: 'BAL-01', name: 'Balance', version: 1, type: 'balance', room: 'RM-1', area: 'Area' };
    const drum = (gross: string, last: string) => ({ balance: bal, tare: { value: '2.10', unit: 'kg' }, gross: { value: gross, unit: 'kg' }, seal: 'S-1', labelChecked: 'yes', lastContainer: last });
    const r1 = walk(doc, [], '0.1.0.1', drum('27.10', 'no'));
    expect(openSteps(doc, r1, at(10_000)).steps.find((x) => x.id === '0.1.0.1')!.results.net).toMatchObject({ ok: true, value: '25' });
    expect(state(doc, r1, '0.1.0.2')).toBe('open');
    const r2 = walk(doc, r1, '0.1.0.2', drum('27.05', 'yes'));
    expect(state(doc, r2, '0.1.0.3')).toBe('absent');
    expect(state(doc, r2, '0.1.1.1')).toBe('open');
  });

  it('TA-26 containers issued count as used less what was counted back at the end (material_use_v1)', () => {
    const doc = small([{ role: 'Packing operator', steps: [
      { key: 'issue', block: { id: 'container-issue', version: 1 }, checker: true, settings: { material: { formula: 'x' }, expected: '4 units' } },
      { key: 'back', block: { id: 'container-return', version: 1 }, checker: true, settings: { material: { formula: 'x' } } }, yieldStep] }]);
    const e1 = walk(doc, [], '0.1.0.1', { lot: 'DRUM-1', issued: { value: '5', unit: 'units' } });
    expect(materialUses(doc, openSteps(doc, e1, at(10_000)).steps).map((u) => u.quantity)).toEqual([{ value: '5', unit: 'units' }]);
    const e2 = walk(doc, e1, '0.1.1.1', { returned: { value: '1', unit: 'units' } });
    expect(materialUses(doc, openSteps(doc, e2, at(10_000)).steps).map((u) => u.quantity)).toEqual([{ value: '4', unit: 'units' }]);
  });
});
