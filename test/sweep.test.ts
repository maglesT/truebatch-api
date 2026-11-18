// The sweep: every block of the library (API) in a small master with all its settings set, and the
// test masters, worked out with every field filled ("1" for a number, yes, the first option), once with the required
// fields only and once with all, in a first and a second round. A template may refuse what it is given; it must never
// crash on it (a crash is "could not use these inputs": the step could not be signed).
import { describe, expect, it } from 'vitest';
import { BLOCKS, findBlock, type Block } from '../shared/blocks/index.js';
import { evaluate, type StepEvent, type Value } from '../shared/engine/index.js';
import { masterChecks } from '../shared/master/checks.js';
import { masterSchema, type MasterDoc, type Step } from '../shared/master/schema.js';
import { at, ev, api } from './engine-fixture.js';

const pct = (low: string, high: string) => ({ low, high, unit: '%' });
// Every setting of every block that has settings, optional ones too.
const SETTINGS: Record<string, Step['settings']> = {
  weigh: { target: { formula: 'x', adjusted: true }, tolerance: '0.5' },
  charge: { material: { formula: 'x' } },
  'charge-liquid': { target: { formula: 'x' }, unit: 'kg', tolerance: '1.0', additionTimeLimit: { low: '10', high: '30', unit: 'min' }, temperatureLimit: { high: '30', unit: '°C' } },
  mix: { speedLimit: { low: '10', high: '20', unit: 'rpm' } },
  react: { temperatureLimit: { low: '75', high: '85', unit: '°C' }, pressureBasis: 'gauge (bar g)', pressureLimit: { low: '0', high: '2', unit: 'bar' }, phLimit: { low: '6', high: '8', unit: 'pH' },
    ipcUnit: '%', ipcLimit: { high: '1.0', unit: '%' } },
  dry: { lodLimit: { high: '2.0', unit: '%' } },
  'dry-constant': { maxChange: '0.5 g' },
  'sub-batch-combine': { accountabilityLimit: pct('99.0', '100.5') },
  'sieve-analysis': { sieve1: '850 µm', sieve2: '425 µm', sieve3: '250 µm', sieve4: '180 µm', sieve5: '150 µm', finesBelow: '150 µm', finesLimit: { high: '20.0', unit: '%' },
    recoveryLimit: pct('98.0', '102.0') },
  check: { what: 'Water by KF', unit: '%', limit: { high: '0.5', unit: '%' } },
  'qa-sample': { sampleLimit: { low: '50', high: '60', unit: 'g' } },
  'stage-yield': { theoretical: { molar: true }, yieldLimit: pct('85.0', '100.5'), accountabilityLimit: pct('99.0', '100.5') },
  'pack-material-issue': { material: { formula: 'x' }, unit: 'units' },
  'printed-reconciliation': { material: { formula: 'x' }, unit: 'units', issued: '100 units' },
};

const item = { itemId: 'eq-1', code: 'EQ-01', name: 'Equipment', version: 1, type: 'balance', room: 'RM-1', area: 'Area' };
/** Every field filled (or the required ones only): "1" in its unit, yes, the first option, a time a few minutes apart. */
function filled(b: Block, settings: Step['settings'], all: boolean): Record<string, Value> {
  let minute = 0;
  const one = (f: Block['fields'][number]): Value => {
    if (f.kind === 'number') {
      const u = f.unit?.startsWith('$') ? settings[f.unit.slice(1)] : f.unit;
      const q = { value: '1', unit: typeof u === 'string' ? u : '' };
      return f.count ? Array.from({ length: f.count }, () => q) : q;
    }
    if (f.kind === 'yes-no') return 'yes';
    if (f.kind === 'choice') return f.options![0]!;
    if (f.kind === 'timer') return `${at(minute += 11).toISOString().slice(0, 19)}Z`;
    if (f.kind === 'machine' || f.kind === 'room') return item;
    if (f.kind === 'lot') return 'L-1';
    return f.date ? '2026-11-03' : '1';
  };
  return Object.fromEntries(b.fields.filter((f) => all || !f.optional).map((f) => [f.name, one(f)]));
}

/** The calculations that crashed, as "step calc: message". */
function crashes(doc: MasterDoc, all: boolean): string[] {
  const events: StepEvent[] = [];
  const out: string[] = [];
  for (const [si, s] of doc.stages.entries()) for (const [ti, t] of s.steps.entries()) {
    const b = findBlock(t.block)!;
    const values = filled(b, t.settings, all);
    for (const round of [1, 2]) {
      const key = `${si}.1.${ti}.${round}`;
      const results = evaluate(doc, events, { stage: si, sub: 1, step: ti, round }, values);
      for (const [n, r] of Object.entries(results)) if (!r.ok && /could not use these inputs/.test(r.message)) out.push(`${s.key}/${t.key} ${n}: ${r.message}`);
      events.push(ev('started', key), ev('value', key, { payload: { values, results } }));
    }
  }
  return out;
}

const header = { productItemId: 'p', productCode: 'P', productName: 'P', batchSize: '100.0', mw: '300.0', retestMonths: 24, dispensingRooms: ['DSP-01'] };
const formula = [{ key: 'x', materialItemId: 'm', code: 'M', name: 'M', stage: 's', role: 'starting material', quantity: '100.0', unit: 'kg', mw: '250.0',
  adjust: { potency: { basis: 'as is', standardIs: 'anhydrous' }, overage: { percent: '2' } } }];
/** A small master of one block with all its settings set. */
function using(b: Block): MasterDoc {
  const step = (x: Block) => ({ key: x.id, block: { id: x.id, version: x.version }, checker: x.checker, settings: SETTINGS[x.id] ?? {} });
  return masterSchema.parse({ header, formula, stages: [{ key: 's', name: 'Stage', kind: 'normal', steps: [step(b)] }] });
}

describe('the sweep: no template crashes on any block or test master', () => {
  it.each(BLOCKS.map((b) => [b.id, b] as const))('%s: all its settings set, its fields filled, required only or all, in two rounds', (id, b) => {
    expect(Object.keys(SETTINGS[id] ?? {}).sort()).toEqual(b.settings.map((s) => s.name).sort());
    for (const all of [false, true]) expect(crashes(using(b), all)).toEqual([]);
    // Its limits and targets are of the kinds of the values they check (TA-01).
    expect(masterChecks(using(b)).filter((p) => /every reading would be refused/.test(p.message))).toEqual([]);
  });

  it.each([['API', api()]] as const)('the %s test master', (_name, doc) => {
    for (const all of [false, true]) expect(crashes(doc, all)).toEqual([]);
    expect(masterChecks(doc).filter((p) => /every reading would be refused/.test(p.message))).toEqual([]);
  });
});
