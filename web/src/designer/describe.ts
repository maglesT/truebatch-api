// A master in plain sentences, section by section (header, formula, each stage), for the review view and for the
// changes view against the previous version. Each line has a key, so two versions can be compared line by line.
import { findBlock } from '../../../shared/blocks/index.js';
import { masterChecks } from '../../../shared/master/checks.js';
import { masterSchema, materialLines, type FormulaLine, type MasterDoc, type Stage, type Step } from '../../../shared/master/schema.js';
import { unitName } from '../../../shared/engine/stock.js';
import { formulaText } from '../../../shared/engine/values.js';
import { stepTitle } from '../../../shared/engine/batch.js';
import { neededText } from '../../../shared/engine/training.js';
import { grouped, placeLabel } from './model.js';
import { limitText, sentence, sentenceText, settingText, slotsOf } from './sentences.js';

export interface Line { key: string; text: string }
export interface Section { key: string; title: string; lines: Line[] }

type Form = NonNullable<NonNullable<FormulaLine['adjust']>['salt']>['from'];
/** A salt form in words: "Examplol hydrochloride (MW 399.9, 1 per unit, with crystal water or solvent, ion charge 1)". */
const formText = (f: Form, or: string) => `${f.name || or} (MW ${f.mw}${f.moleculesPerUnit ? `, ${f.moleculesPerUnit} per unit` : ''}${f.hydrateOrSolvate ? ', with crystal water or solvent' : ''}${f.charge ? `, ion charge ${f.charge}` : ''})`;

function adjustText(l: FormulaLine): string {
  const a = l.adjust;
  if (!a) return '';
  const out: string[] = [];
  if (a.salt) out.push(`converted from the ${formText(a.salt.from, 'formula form')} to the ${formText(a.salt.to, 'dispensed form')}${a.salt.factor ? ` (salt factor written as ${a.salt.factor})` : ''}`);
  if (a.potency) out.push(`adjusted for the lot's assay on the ${a.potency.basis} basis${a.potency.assayExpressedAs ? ` (the assay expressed on the ${a.potency.assayExpressedAs})` : ''}${a.potency.standardIs ? `, the formula quantity being the ${a.potency.standardIs} weight` : ''}${a.potency.potencyAs ? `, potency stated as ${a.potency.potencyAs}` : ''}${a.potency.assayAbove100 === 'treat as 100' ? ', an assay above 100 % taken as 100 %' : a.potency.assayAbove100 === 'use' ? ', an assay above 100 % used as found' : ''}`);
  if (a.content) out.push(`adjusted for the ${a.content.contentSource === 'in-process result' ? 'in-process' : "lot's"} content${a.content.contentSource === 'certificate' ? ' from its certificate' : ''}, the formula quantity being of the ${a.content.formulaQuantityIs === 'dry' ? 'pure material' : 'material as supplied'}${a.content.nominalContent ? ` (nominal ${a.content.nominalContent} %)` : ''}${a.content.resultType ? `, the result being ${a.content.resultType === 'content' ? 'the content' : '% of theoretical'}` : ''}`);
  if (a.overage) out.push(`with ${a.overage.percent} % overage${a.overage.maxPercent ? ` (at most ${a.overage.maxPercent} %)` : ''}`);
  return `; at dispensing ${out.join(', then ')}`;
}

/** A hold time in hours, and in days when it is whole days of two or more: "720 hours (30 days)". */
const holdText = (h: number | undefined) => (h === undefined ? '(not set)' : `${h} hours${h >= 48 && h % 24 === 0 ? ` (${h / 24} days)` : ''}`);

function stageText(doc: MasterDoc, s: Stage): string {
  const kind = s.kind === 'preparation' ? 'A preparation' : s.kind === 'sub-batch' ? `Done in ${s.count ?? '?'} sub-batches` : 'A stage';
  const uses = s.uses.map((k) => doc.stages.find((x) => x.key === k)).map((x, n) => (x ? `${x.produces?.name ?? x.name} from ${x.name}` : `a stage no longer in this master (${s.uses[n]})`));
  return [`${kind}, the responsibility of the ${s.role || '(role not set)'}.`,
    `Machine types: ${s.machineTypes.join(', ') || 'any'}. Rooms: ${s.roomTypes.join(', ') || 'any'}.`,
    uses.length ? `Uses ${uses.join(' and ')}.` : '',
    s.produces ? `Produces ${s.produces.name}, to be used within ${holdText(s.produces.holdHours)}${s.produces.mw ? `; MW ${s.produces.mw} g/mol` : ''}${s.produces.expectedKg ? `; ${s.produces.expectedKg} kg expected per batch` : ''}${s.produces.perMol ? `; ${s.produces.perMol} mol made per mol of the key input` : ''}.` : 'Produces no intermediate.',
    s.kind === 'sub-batch' || s.count === undefined ? '' : `Count ${s.count}.`].filter(Boolean).join(' ');
}

/** Master data's units of the materials, by item id: a unit is named as master data names it when the same (nos for units). */
export type Units = ReadonlyMap<string, string>;

export function stepText(doc: MasterDoc, t: Step, j: number, units?: Units): string {
  const b = findBlock(t.block);
  if (!b) return `${j + 1}. Unknown block ${t.block.id} version ${t.block.version}.`;
  const slots = slotsOf(b);
  const m = Object.values(t.settings).find((v): v is { formula: string } => typeof v === 'object' && 'formula' in v);
  const stock = m && units?.get(materialLines(doc).find((l) => l.key === m.formula)?.materialItemId ?? '');
  const shown = (name: string) => {
    const v = t.settings[name];
    if (name === 'unit' && typeof v === 'string' && v) return unitName(v, stock);
    // A material picked from the formula by its name and code, as the floor names it (not "the batch quantity of").
    const line = b.settings.find((x) => x.name === name)?.kind === 'material' && typeof v === 'object' && 'formula' in v ? materialLines(doc).find((l) => l.key === v.formula) : undefined;
    return line ? `${line.name} (${line.code})` : settingText(doc, v);
  };
  const loose = b.settings.filter((s) => !slots.has(s.name) && t.settings[s.name] !== undefined).map((s) => `${s.label.replace(/ \(formula line\)$/, '')}: ${shown(s.name)}.`);
  const calcs = b.calcs.map((c) => sentenceText(doc, b, t.settings, sentence(b, c)));
  const flow = t.flow.kind === 'repeat-until' ? `Repeated until the check "${b.calcs.find((c) => c.name === ((t.flow.kind === 'repeat-until' && t.flow.stop) || b.stop))?.label ?? '(not chosen)'}" passes, at most ${t.flow.maxRounds ?? '?'} rounds${t.everyMinutes ? `, a round every ${t.everyMinutes} minutes` : ''}.`
    : t.flow.kind === 'optional-with-reason' ? 'Optional: it may be skipped with a reason.' : t.flow.kind === 'qa-hold' ? 'QA hold: QA releases it before the next step.' : '';
  // A round time on a step that does not repeat is still shown (the repeat-until sentence says it otherwise).
  const every = t.everyMinutes && t.flow.kind !== 'repeat-until' ? `A round every ${t.everyMinutes} minutes.` : '';
  // A step by its title as on the floor (with its material's name and code), never its internal key.
  const steps = doc.stages.find((s) => s.steps.includes(t))?.steps ?? [];
  const after = steps.findIndex((x) => x.key === t.orderAfter);
  // A block's later version is named (each version is its own description file); the first one is not.
  return [`${j + 1}. ${stepTitle(doc, t)}${t.block.version > 1 ? ` (block version ${t.block.version})` : ''}: ${t.instruction ?? b.instruction}`, ...loose, ...calcs,
    `Signed by the operator${t.checker ? ' and checked by a second person' : ''}${t.waitForCheck ? '; the next step waits for the check' : ''}.`,
    t.training ? neededText(t.training, t.checker) : '',
    t.critical ? 'Critical step.' : '', t.minMinutes ? `Takes at least ${t.minMinutes} minutes.` : '', flow, every,
    t.everyMinutesLater ? `After ${t.everyMinutesLater.afterMinutes} minutes, a round every ${t.everyMinutesLater.everyMinutes} minutes.` : '',
    t.onlyIf ? `Done only when the batch size is ${limitText(t.onlyIf.limit)}; otherwise left out.` : '',
    t.orderAfter ? `Order-critical: after step ${after < 0 ? '(no longer in this stage)' : `${after + 1}. ${stepTitle(doc, steps[after]!)}`}.` : ''].filter(Boolean).join(' ');
}

/**
 * The master in sentences. `items`: also the master data item of the API and of each material (an id, so only for the
 * changes view, where it shows only when it changed: the same code and name picked as another item).
 */
export function describeMaster(doc: MasterDoc, units?: Units, { items = false } = {}): Section[] {
  const h = doc.header;
  const top: Section[] = [
    { key: 'header', title: 'Header', lines: [
      { key: 'product', text: `API ${h.productCode}, ${h.productName}${h.mw ? `; molecular weight as isolated ${h.mw} g/mol` : ''}.` },
      { key: 'batch', text: `Batch size ${h.batchSize} kg of API expected.` },
      { key: 'retest', text: `Retest period ${h.retestMonths} months from the date of manufacture.` },
      ...(h.intermediate ? [{ key: 'intermediate', text: 'Makes an intermediate that goes to stores.' }] : []),
      ...(h.dispensingRooms?.length ? [{ key: 'dispensing', text: `Weighed in the dispensing rooms ${h.dispensingRooms.join(', ')}.` }] : []),
    ] },
    { key: 'formula', title: 'Formula', lines: doc.formula.map((l) => ({ key: l.key,
      text: `${l.name} (${l.code}), ${l.role} in ${doc.stages.find((s) => s.key === l.stage)?.name ?? l.stage}: ${formulaText(l)}${l.mw ? `; MW ${l.mw} g/mol` : ''}${l.density ? `; density ${l.density} kg/L` : ''}${l.recovered ? `; may be charged recovered: ${l.recovered.name} (${l.recovered.code})` : ''}${adjustText(l)}.` })) },
  ];
  return [
    ...top,
    ...doc.stages.map((s, i) => ({ key: `stage:${s.key}`, title: `Stage ${i + 1}: ${s.name}`, lines: [
      { key: 'about', text: stageText(doc, s) },
      ...s.steps.map((t, j) => ({ key: t.key, text: stepText(doc, t, j, units) })),
    ] })),

    // The calculation checks the author answered (or not yet), for the checker and QA; only when there are some.
    ...[{ key: 'answers', title: 'Calculation checks', lines: masterChecks(doc).flatMap((p) => (p.question ? [{ key: p.question.key,
      text: `${placeLabel(doc, p.path)}: ${p.message} ${p.question.answer ? `Answered: ${p.question.answer.choice}${p.question.answer.reason ? `. Reason: ${p.question.answer.reason}` : ''}.` : 'Not answered yet.'}` }] : [])) }].filter((s) => s.lines.length),
    ...(items ? [{ key: 'items', title: 'Master data items', lines: [
      { key: 'product', text: `API ${h.productCode}: master data item ${h.productItemId}.` },
      ...doc.formula.flatMap((l) => [{ key: `formula:${l.key}`, text: `${l.name} (${l.code}): master data item ${l.materialItemId}.` },
        ...(l.recovered ? [{ key: `recovered:${l.key}`, text: `${l.recovered.name} (${l.recovered.code}): master data item ${l.recovered.materialItemId}.` }] : [])]),
    ] }] : []),
  ];
}

export type Change = 'same' | 'added' | 'changed' | 'removed';
export interface DiffLine extends Line { change: Change; was?: string }
export interface DiffSection { key: string; title: string; change: Change; lines: DiffLine[] }

/** The changes from the previous version, line by line (by key; a step that moved shows its new number). */
export function diffMasters(prev: MasterDoc, next: MasterDoc, units?: Units): DiffSection[] {
  const before = new Map(describeMaster(prev, units, { items: true }).map((s) => [s.key, s]));
  const after = describeMaster(next, units, { items: true });
  const out: DiffSection[] = after.map((s) => {
    const old = before.get(s.key);
    // A section renamed (a stage's name, or its number when one is added or moved before it) is a change too.
    const title: DiffLine[] = old && old.title !== s.title ? [{ key: ':title', text: `Now called "${s.title}".`, change: 'changed', was: `"${old.title}"` }] : [];
    const lines: DiffLine[] = [...title, ...s.lines.map((l): DiffLine => {
      const was = old?.lines.find((x) => x.key === l.key)?.text;
      return { ...l, change: was === undefined ? 'added' : was === l.text ? 'same' : 'changed', ...(was !== undefined && was !== l.text ? { was } : {}) };
    })];
    for (const l of old?.lines ?? []) if (!s.lines.some((x) => x.key === l.key)) lines.push({ ...l, change: 'removed' });
    return { key: s.key, title: s.title, change: !old ? 'added' : lines.some((l) => l.change !== 'same') ? 'changed' : 'same', lines };
  });
  for (const s of before.values()) if (!after.some((x) => x.key === s.key)) out.push({ ...s, change: 'removed', lines: s.lines.map((l) => ({ ...l, change: 'removed' })) });
  // The safety net (Tablets round 38): the two versions differ but no line above shows it (a field without a line).
  // Never "No changes" then: the changed fields are listed by their path, for the checker and QA to look at.
  if (out.every((s) => s.change === 'same')) {
    const paths = changedPaths(stored(prev), stored(next));
    if (paths.length) out.push({ key: UNDESCRIBED, title: 'Changed (not described)', change: 'changed', lines: [{ key: 'paths', text: notDescribedText(paths), change: 'changed' }] });
  }
  return out;
}

/** The key of the safety net's section in the changes view. */
export const UNDESCRIBED = 'undescribed';
/** A master as the schema reads it (the defaults filled in), so a default the stored version leaves out is no change. */
const stored = (doc: MasterDoc): unknown => { const r = masterSchema.safeParse(doc); return r.success ? r.data : doc; };
const SHOWN_PATHS = 20;
export const notDescribedText = (paths: string[]) =>
  `Changed (not described): ${paths.slice(0, SHOWN_PATHS).join(', ')}${paths.length > SHOWN_PATHS ? ` and ${paths.length - SHOWN_PATHS} more` : ''}.`;

/** The paths of the values that differ between two JSON values ("stages[1].steps[0].flow.maxRounds"); a missing key is undefined. */
export function changedPaths(a: unknown, b: unknown, at = ''): string[] {
  if (a === b) return [];
  const object = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (Array.isArray(a) && Array.isArray(b)) {
    return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => changedPaths(a[i], b[i], `${at}[${i}]`)).flat();
  }
  if (object(a) && object(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((k) => changedPaths(a[k], b[k], at ? `${at}.${k}` : k));
  }
  return [at || '(the whole master)'];
}
