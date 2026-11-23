// Tablets round 38, ported. Guard: every field of a master shows in the plain-language changes view. For each field of the master schema, a
// valid version that changes only that field must show at least one changed line (diffMasters), so a checker or QA
// never signs "No changes" over a real change. The field list comes from the zod schema itself: a field added to the
// schema later fails here until the base masters below carry a value for it and describe.ts gives it a line.
// Next to it, the safety net: a change no line shows is still listed, by its field path, never "No changes".
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { masterChecks } from '../shared/master/checks.js';
import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import { changedPaths, diffMasters, notDescribedText, UNDESCRIBED } from '../web/src/designer/describe.js';
import { api } from './engine-fixture.js';

type Seg = string | number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any; // zod 4 nests core types that do not unify with ZodType
// zod 4: the discriminator key sits in the definition.
const discOf = (s: unknown): string => (s as { def: { discriminator: string } }).def.discriminator;

/** Every field of a schema as an abstract path: "stages[].steps[].flow<repeat-until>.maxRounds", "…settings{}|1.low". */
function schemaPaths(s: Any, at: string, out: Set<string>): Set<string> {
  if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) return schemaPaths(s.unwrap(), at, out);
  if (s instanceof z.ZodDefault) return schemaPaths(s.def.innerType, at, out);
  if (s instanceof z.ZodObject) {
    for (const [k, v] of Object.entries(s.shape as Record<string, Any>)) schemaPaths(v, `${at}.${k}`, out);
    return out;
  }
  if (s instanceof z.ZodArray) return schemaPaths(s.element, `${at}[]`, out);
  if (s instanceof z.ZodRecord) return schemaPaths(s.valueType, `${at}{}`, out);
  if (s instanceof z.ZodDiscriminatedUnion) {
    for (const o of s.options as z.ZodObject<z.ZodRawShape>[]) schemaPaths(o, `${at}<${(o.shape[discOf(s)] as z.ZodLiteral<string>).value}>`, out);
    return out;
  }
  if (s instanceof z.ZodUnion) {
    (s.options as Any[]).forEach((o, i) => schemaPaths(o, `${at}|${i}`, out));
    return out;
  }
  if (s instanceof z.ZodString || s instanceof z.ZodNumber || s instanceof z.ZodBoolean || s instanceof z.ZodEnum || s instanceof z.ZodLiteral) {
    out.add(at.replace(/^\./, ''));
    return out;
  }
  throw new Error(`The guard does not know the zod type at ${at}: teach schemaPaths and variants about it`);
}

interface Variant { field: string; at: string; doc: unknown }

const setAt = (doc: unknown, segs: Seg[], value: unknown): unknown => {
  const copy = structuredClone(doc) as Record<string | number, unknown>;
  let o = copy;
  for (const s of segs.slice(0, -1)) o = o[s] as Record<string | number, unknown>;
  const last = segs.at(-1)!;
  if (value === undefined) {
    if (Array.isArray(o)) o.splice(last as number, 1); else delete o[last];
  } else o[last] = value;
  return copy;
};
const shown = (segs: Seg[]) => segs.map((s) => (typeof s === 'number' ? `[${s}]` : `.${s}`)).join('').replace(/^\./, '');

/** Other values for one field: each other choice of a list, a flipped yes/no, a number ± 1, a text changed at its end. */
function others(s: Any, v: unknown): unknown[] {
  if (s instanceof z.ZodEnum) return (s.options as string[]).filter((o) => o !== v);
  if (s instanceof z.ZodBoolean) return [!v];
  if (s instanceof z.ZodNumber) return [(v as number) + 1, (v as number) - 1];
  if (s instanceof z.ZodString) {
    const t = v as string;
    const last = t.at(-1) ?? '';
    return [`${t}1`, `${t}x`, /\d/.test(last) ? `${t.slice(0, -1)}${(Number(last) + 1) % 10}` : `${t.slice(0, -1)}x`, 'x'].filter((x) => x !== t);
  }
  return [];
}

/**
 * The versions that change one field of `doc` (each candidate value; the first one the schema takes is used), and the
 * abstract paths of the fields the base master carries. Optional fields are also left out, list entries removed.
 */
function variants(base: unknown): { list: Variant[][]; seen: Set<string> } {
  const list: Variant[][] = [];
  const seen = new Set<string>();
  const walk = (s: Any, v: unknown, segs: Seg[], at: string): void => {
    if (s instanceof z.ZodOptional || s instanceof z.ZodNullable || s instanceof z.ZodDefault) {
      if (v === undefined) return;
      list.push([{ field: `${at} (left out)`, at: shown(segs), doc: setAt(base, segs, undefined) }]);
      return walk(s instanceof z.ZodDefault ? s.def.innerType : s.unwrap(), v, segs, at);
    }
    if (s instanceof z.ZodObject) {
      for (const [k, f] of Object.entries(s.shape as Record<string, Any>)) walk(f, (v as Record<string, unknown>)[k], [...segs, k], `${at}.${k}`);
      return;
    }
    if (s instanceof z.ZodArray) {
      const a = v as unknown[];
      a.forEach((x, i) => walk(s.element, x, [...segs, i], `${at}[]`));
      if (a.length) list.push([{ field: `${at}[] (one removed)`, at: shown(segs), doc: setAt(base, [...segs, a.length - 1], undefined) }]);
      // A list of plain values (rooms, machine types): one more.
      if (a.length && !(typeof a[0] === 'object')) list.push(others(s.element, a.at(-1)).map((x) => ({ field: `${at}[] (one added)`, at: shown(segs), doc: setAt(base, [...segs, a.length], x) })));
      return;
    }
    if (s instanceof z.ZodRecord) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        walk(s.valueType, x, [...segs, k], `${at}{}`);
        list.push([{ field: `${at}{} (one removed)`, at: shown([...segs, k]), doc: setAt(base, [...segs, k], undefined) }]);
      }
      return;
    }
    if (s instanceof z.ZodDiscriminatedUnion) {
      const kind = (v as Record<string, string>)[discOf(s)]!;
      const options = s.options as z.ZodObject<z.ZodRawShape>[];
      const o = options.find((x) => (x.shape[discOf(s)] as z.ZodLiteral<string>).value === kind)!;
      walk(o, v, segs, `${at}<${kind}>`);
      for (const x of options) {
        const k = (x.shape[discOf(s)] as z.ZodLiteral<string>).value;
        if (k !== kind) list.push([{ field: `${at}<${kind}>.${discOf(s)} → ${k}`, at: shown(segs), doc: setAt(base, segs, { [discOf(s)]: k }) }]);
      }
      return;
    }
    if (s instanceof z.ZodUnion) {
      const i = (s.options as Any[]).findIndex((o) => o.safeParse(v).success);
      return walk((s.options as Any[])[i]!, v, segs, `${at}|${i}`);
    }
    const field = at.replace(/^\./, '');
    seen.add(field);
    if (s instanceof z.ZodLiteral) return;
    if (s instanceof z.ZodEnum) {
      // Each other choice must read differently: two choices said in the same words would hide a change between them.
      for (const x of others(s, v)) list.push([{ field: `${field} = ${String(x)}`, at: shown(segs), doc: setAt(base, segs, x) }]);
      return;
    }
    list.push(others(s, v).map((x) => ({ field, at: shown(segs), doc: setAt(base, segs, x) })));
  };
  walk(masterSchema, base, [], '');
  return { list, seen };
}

/** Whether the changes view shows a line that changed (the safety net's own section left aside). */
const describedChange = (prev: MasterDoc, next: MasterDoc) =>
  diffMasters(prev, next).filter((s) => s.key !== UNDESCRIBED).some((s) => s.change !== 'same');

// An API master that carries every field of the schema at least once: the engine's fixture, with an intermediate to
// stores, a formula line with every adjustment and a recovered form, an intermediate's molar fields, a step with every
// step setting (in the order it must keep, so an answered calculation check), and a round time on a step that does not repeat.
function fullApi(): MasterDoc {
  const doc = api();
  doc.header.intermediate = true;
  Object.assign(doc.formula[0]!, {
    density: '1.10', recovered: { materialItemId: 'mat-ksm-r', code: 'MAT-001-R', name: 'Examplol acid, recovered' },
    adjust: {
      salt: { from: { name: 'Examplol hydrochloride', mw: '399.9', moleculesPerUnit: 1, hydrateOrSolvate: true, charge: 1 }, to: { name: 'Examplol base', mw: '363.4', moleculesPerUnit: 2, hydrateOrSolvate: true, charge: 2 }, factor: '1.1004' },
      potency: { basis: 'dried', standardIs: 'anhydrous', assayExpressedAs: 'anhydrous substance', potencyAs: 'parent', assayAbove100: 'treat as 100' },
      content: { formulaQuantityIs: 'dry', nominalContent: '95.0', contentSource: 'certificate', resultType: 'content' },
      overage: { percent: '2.0', maxPercent: '5.0' },
    },
  });
  const step1 = doc.stages[1]!;
  step1.roomTypes = ['API synthesis'];
  step1.produces = { name: 'intermediate 1', holdHours: 72, mw: '330.0', expectedKg: '120.0', perMol: '1.0' };
  // The full step, before the mill it must follow: the order-critical question, answered.
  step1.steps.splice(step1.steps.findIndex((t) => t.key === 'mill'), 0, { key: 'check-all', block: { id: 'check', version: 1 }, name: 'Appearance of the cake', instruction: 'Look at the cake.',
    settings: { what: 'Appearance score', unit: 'mm', limit: { low: '1', high: '9', unit: 'mm', lowStrict: true, highStrict: true, alertLow: '2', alertHigh: '8' } },
    checker: true, waitForCheck: true, critical: true, minMinutes: 5, everyMinutes: 30, everyMinutesLater: { afterMinutes: 60, everyMinutes: 15 },
    onlyIf: { header: 'batchSize', limit: { low: '10', high: '2000', unit: 'kg', lowStrict: true, highStrict: true, alertLow: '20', alertHigh: '1000' } },
    orderAfter: 'mill', flow: { kind: 'repeat-until', maxRounds: 3, stop: 'readingCheck' }, training: { code: 'SK-001', title: 'Visual inspection' } });
  // A round time on a step that does not repeat; a setting that reads an earlier step.
  step1.steps.push({ key: 'sample', block: { id: 'qa-sample', version: 1 }, checker: false, waitForCheck: false, critical: false, everyMinutes: 20, settings: {}, flow: { kind: 'optional-with-reason' } });
  doc.stages[3]!.steps.find((t) => t.key === 'yield')!.settings.theoretical = { ref: 'salt/yield/output' };
  const q = masterChecks(doc).find((p) => p.question?.key === 'order/step1/check-all')!;
  doc.answers = { 'order/step1/check-all': { about: q.message, choice: q.question!.options[0]!, reason: 'The new order was checked.' } };
  return masterSchema.parse(doc);
}

describe('every field of a master shows in the changes view (no "No changes" over a real change)', () => {
  const bases = { api: fullApi() };
  const all = schemaPaths(masterSchema, '', new Set());
  const runs = Object.entries(bases).map(([name, doc]) => ({ name, doc, ...variants(doc) }));

  it('the base master carries every field of the schema', () => {
    const seen = new Set(runs.flatMap((r) => [...r.seen]));
    expect([...all].filter((p) => !seen.has(p)), 'fields of the schema the base master does not carry: give them a value in fullApi').toEqual([]);
  });
  for (const r of runs) {
    it(`each one-field change of the ${r.name} master shows a changed line`, () => {
      const hidden: string[] = [];
      const invalid: string[] = [];
      for (const candidates of r.list) {
        const ok = candidates.map((c) => ({ c, p: masterSchema.safeParse(c.doc) })).find((x) => x.p.success);
        if (!ok) { if (candidates[0]) invalid.push(candidates[0].field); continue; }
        const next = ok.p.data as MasterDoc;
        // Leaving out a field whose default is the value it had changes nothing.
        if (!changedPaths(r.doc, next).length) continue;
        if (!describedChange(r.doc, next)) hidden.push(`${ok.c.field} (${ok.c.at})`);
      }
      expect(invalid, 'fields the guard found no valid other value for').toEqual([]);
      expect(hidden, 'fields whose change no line of the changes view shows: give them a line in describe.ts').toEqual([]);
    });
  }
});

describe('the safety net: a change that no line shows is listed by its field path', () => {
  it('lists the changed fields when no described line changed, and says nothing when nothing changed', () => {
    const prev = fullApi();
    expect(diffMasters(prev, structuredClone(prev)).every((s) => s.change === 'same')).toBe(true);
    // A key the schema does not know (a stored version the schema never checked): no line words it.
    const next = structuredClone(prev);
    (next.stages[0]!.steps[0] as Record<string, unknown>).hidden = 'x';
    const d = diffMasters(prev, next);
    const net = d.find((s) => s.key === UNDESCRIBED)!;
    expect(net).toMatchObject({ title: 'Changed (not described)', change: 'changed' });
    expect(net.lines[0]!.text).toBe('Changed (not described): stages[0].steps[0].hidden.');
    expect(d.filter((s) => s.key !== UNDESCRIBED).every((s) => s.change === 'same')).toBe(true);
  });

  it('does not list a default the stored version leaves out (the same master)', () => {
    const prev = fullApi();
    const next = structuredClone(prev);
    delete (next.stages[0]!.steps[0] as Partial<MasterDoc['stages'][number]['steps'][number]>).critical;
    expect(diffMasters(prev, next).some((s) => s.key === UNDESCRIBED)).toBe(false);
  });

  it('is not added when a described line changed', () => {
    const prev = fullApi();
    const next = structuredClone(prev);
    next.header.batchSize = '200.0';
    (next.stages[0]!.steps[0] as Record<string, unknown>).hidden = 'x';
    expect(diffMasters(prev, next).some((s) => s.key === UNDESCRIBED)).toBe(false);
  });

  it('names the paths, at most twenty, then how many more', () => {
    expect(notDescribedText(Array.from({ length: 25 }, (_, i) => `x[${i}]`))).toBe(`Changed (not described): ${Array.from({ length: 20 }, (_, i) => `x[${i}]`).join(', ')} and 5 more.`);
    const a = { x: Array.from({ length: 25 }, (_, i) => i) };
    const b = { x: Array.from({ length: 25 }, (_, i) => i + 1) };
    expect(changedPaths(a, b)).toHaveLength(25);
    expect(changedPaths({ a: 1, b: [1, 2] }, { a: 1, b: [1], c: undefined })).toEqual(['b[1]']);
    expect(changedPaths({ a: { b: 'x' } }, { a: { b: 'x', c: 'y' } })).toEqual(['a.c']);
  });
});
