/**
 * Master checks: pure checks over one master document. Each problem is an error (⛔, the version cannot be approved)
 * or a warning (⚠️), with the path to the item. Template settings are checked by the templates library itself.
 * The calculation checks (calculationChecks below) are error-proofing of the calculations, not GMP rules.
 */
import { findBlock, type Block } from '../blocks/index.js';
import { Dec, c1WithinLimits, findUnit, t11SaltFactor } from '../templates/index.js';
import { evaluate, keyInput, lineQuantity, molarTheoretical } from '../engine/values.js';
import { materialLines, type Answer, type Limit, type MasterDoc, type SettingValue } from './schema.js';
import { neededKind, unitKindProblem, what as kindWords } from './kinds.js';
import { isBalance } from '../engine/picks.js';

/** A warning the author answers: one of the options, with a reason when `needsReason`. */
export interface Question { key: string; options: string[]; needsReason: boolean; answer?: Answer }
export interface Problem { level: 'error' | 'warning'; path: string; message: string; rule?: string; question?: Question }

/**
 * A message in plain words for the people who read it: without the internal codes of the rules (TA-11), templates
 * (T9) and failure cases (F0204) the code comments use. The rule stays in `rule` for the tests.
 */
export const plainWords = (m: string) => m
  .replace(/\s*\((?:TB-P?\d+|T\d+)\)/g, '')
  .replace(/\bF0\d{3}:\s*/g, '')
  .replace(/\s*\(F0\d{3}\)/g, '');

/** What stops "Send for review" and approval: an error, or a warning that needs an answer and has none. */
export const blocking = (p: Problem) => p.level === 'error' || (p.question !== undefined && !p.question.answer);

const QUANTITY = /^[+-]?(\d+(\.\d*)?|\.\d+)\s*(\S.*)?$/;
const DECIMAL = /^\d+(\.\d+)?$/;
// Neutral certificate values for checking a formula line's adjustment settings with the templates themselves.
const SAMPLE = { assay: { value: '100.0', unit: '%' }, water: { value: '0', unit: '%' }, lod: { value: '0', unit: '%' } };
const HERE = { stage: 0, sub: 1, step: 0, round: 1 };

export function masterChecks(doc: MasterDoc): Problem[] {
  const out: Problem[] = [];
  const error = (path: string, message: string, rule?: string) => out.push({ level: 'error', path, message, ...(rule ? { rule } : {}) });
  const warn = (path: string, message: string) => out.push({ level: 'warning', path, message });
  const twice = (keys: string[], path: string) => keys.forEach((k, i) => keys.indexOf(k) !== i && error(`${path}[${i}]`, `The key ${k} is used twice`));

  formulaChecks(doc, out, error);

  twice(doc.stages.map((s) => s.key), 'stages');
  // TA-11: a master that weighs names the rooms its materials are weighed in (its balances are offered there).
  const weighs = doc.stages.some((s) => s.steps.some((t) => findBlock(t.block)?.fields.some((f) => f.kind === 'machine' && isBalance(f))));
  if (weighs && !doc.header.dispensingRooms?.length) error('header.dispensingRooms', 'The master weighs but names no dispensing rooms: choose them in the header (rooms of master data)', 'TA-11');
  doc.stages.forEach((s, si) => {
    const path = `stages[${si}]`;
    twice(s.steps.map((t) => t.key), `${path}.steps`);
    if (s.kind === 'sub-batch' && !s.count) error(path, 'A sub-batch stage needs the number of sub-batches');
    if (s.produces && !s.produces.holdHours) error(`${path}.produces`, `The intermediate ${s.produces.name} has no hold time`, 'TA-01');
    // Everything the plain view would show as "(not set)" is reported here (the plain view's sentences, describe.ts).
    if (!s.role.trim()) warn(path, `Stage ${s.name} names no responsible role`);
    if (s.kind !== 'preparation' && !s.steps.some((t) => findBlock(t.block)?.gmp === 'yield')) error(path, `Stage ${s.name} has no yield step`);
    if (s.kind === 'preparation' && !doc.stages.some((x) => x.uses.includes(s.key))) warn(path, `No stage uses the preparation ${s.name}`);
    // TA-10: a stage worked in a room starts with line clearance.
    const clearance = s.steps.findIndex((t) => findBlock(t.block)?.gmp === 'line-clearance');
    if (s.roomTypes.length && clearance < 0) error(path, `Stage ${s.name} is worked in a room but has no line clearance step`, 'TA-10');
    if (clearance > 0) warn(`${path}.steps[${clearance}]`, `Line clearance is not the first step of ${s.name}`);
    // TA-11: a stage that works machines (not balances) or names a room
    // runs only in the rooms it allows (shared/engine/picks.ts).
    const placed = s.steps.some((t) => { const b = findBlock(t.block); return b?.fields.some((f) => f.kind === 'room' || (f.kind === 'machine' && !isBalance(f))); });
    if (placed && !s.roomTypes.length) error(`${path}.roomTypes`, `Stage ${s.name}: choose the rooms this stage may run in (an area or a room of master data, in the stage settings)`, 'TA-11');
    for (const u of s.uses) {
      const pi = doc.stages.findIndex((x) => x.key === u);
      if (pi < 0 || pi >= si) error(`${path}.uses`, `${u} is not an earlier stage`);
      else if (!doc.stages[pi]!.produces) error(`${path}.uses`, `Stage ${doc.stages[pi]!.name} produces no intermediate`);
    }
    s.steps.forEach((st, ti) => {
      const p = `${path}.steps[${ti}]`;
      const block = findBlock(st.block);
      if (!block) return void error(`${p}.block`, `No block ${st.block.id} version ${st.block.version}`);
      if (!st.checker && (block.gmp || st.critical)) error(p, `${block.gmp ? `A ${block.gmp.replace('line-clearance', 'line clearance')} step` : 'A critical step'} needs a second-person check`, 'TA-08');
      if (st.critical && st.flow.kind === 'optional-with-reason') error(`${p}.flow`, 'A critical step cannot be optional');
      if (st.waitForCheck && !st.checker) warn(p, 'The next step waits for a check this step does not have');
      for (const bs of block.settings) if (!bs.optional && st.settings[bs.name] === undefined) error(`${p}.settings.${bs.name}`, `${bs.label} is not set`);
      for (const [name, v] of Object.entries(st.settings)) {
        const bs = block.settings.find((x) => x.name === name);
        const listed = !bs?.options || (typeof v === 'string' && bs.options.includes(v));
        const why = !bs ? `The block ${block.name} has no setting ${name}` : listed ? settingProblem(doc, si, ti, block, bs, st.settings, v) : `${bs.label}: choose one of ${bs.options!.join(', ')}`;
        if (why) error(`${p}.settings.${name}`, why);
        // TA-01: a limit (or a typed target) in a unit of another kind than the value it checks.
        const unit = typeof v === 'object' && 'unit' in v ? v.unit : typeof v === 'string' && bs?.kind === 'quantity' ? QUANTITY.exec(v)?.[3] : undefined;
        const wrong = !why && unit !== undefined ? unitKindProblem(block, name, st.settings, unit) : null;
        if (wrong) error(`${p}.settings.${name}`, wrong, 'TA-01');
      }
      // A temperature recorded with optional limits left empty is recorded without a check (the disintegration
      // medium at 37 ± 2 °C, an inlet or forming temperature): a warning, so the author sets them or leaves them knowingly.
      for (const c of block.calcs) {
        const a = c.args as { value?: unknown; limit?: unknown };
        const lim = c.template === 'C1' && typeof a.limit === 'string' ? block.settings.find((x) => x.name === a.limit!.toString().slice(1) && x.optional) : undefined;
        const f = typeof a.value === 'string' ? block.fields.find((x) => x.name === (a.value as string).slice(1)) : undefined;
        if (lim && f && findUnit(f.unit ?? '')?.kind === 'temperature' && st.settings[lim.name] === undefined) warn(`${p}.settings.${lim.name}`, `${f.label} is recorded but not checked: set the ${lim.label.toLowerCase()}`);
      }
      // A calculation that needs no recorded value is worked out now (e.g. a liquid make-up, T17): a refusal must be fixed.
      const now = evaluate(doc, [], { stage: si, sub: 1, step: ti, round: 1 }, {});
      for (const c of block.calcs) { const r = now[c.name]; if (r && !r.ok) error(p, `${c.label}: ${r.message}`); }
      if (st.flow.kind === 'repeat-until') {
        if (!st.flow.maxRounds) error(`${p}.flow`, 'A repeat-until step needs the most rounds allowed');
        const stop = st.flow.stop ?? block.stop;
        if (!stop || !block.calcs.some((c) => c.name === stop)) error(`${p}.flow`, 'A repeat-until step needs a stop check (a calculation of its block)');
      }
      if (st.everyMinutes && st.flow.kind !== 'repeat-until') error(`${p}.everyMinutes`, 'Checks every N minutes need a repeat-until step');
      const later = st.everyMinutesLater;
      if (later && !st.everyMinutes) error(`${p}.everyMinutesLater`, 'A later interval needs the interval of the first checks');
      if (later && block.periodic && later.everyMinutes > block.periodic.maxMinutes) error(`${p}.everyMinutesLater`, `Periodic checks every ${later.everyMinutes} min: they must be at least every ${block.periodic.maxMinutes} min`, 'TA-15');
      if (st.onlyIf) {
        const r = c1WithinLimits({ value: { value: '0', unit: 'kg' }, limit: st.onlyIf.limit });
        if (!r.ok) error(`${p}.onlyIf`, `The rule for leaving the step out: ${r.message}`);
      }
      if (block.periodic && !st.everyMinutes) error(`${p}.everyMinutes`, `${block.name} needs the interval of its periodic checks`, 'TA-15');
      if (block.periodic && st.everyMinutes && st.everyMinutes > block.periodic.maxMinutes) {
        error(`${p}.everyMinutes`, `Periodic checks every ${st.everyMinutes} min: they must be at least every ${block.periodic.maxMinutes} min`, 'TA-15');
      }
    });
  });
  packChecks(doc, error);
  return out.map((p) => ({ ...p, message: plainWords(p.message) }));
}

/**
 * TA-26 (owner, 18 Nov 2026: Pack and label is the last stage of the record): a master that packs fills and labels the
 * containers in its last stage; every label issued is reconciled from its own issue; batch-coded leftovers are destroyed.
 */
function packChecks(doc: MasterDoc, error: (path: string, message: string, rule?: string) => void): void {
  const last = doc.stages.at(-1);
  const PACK = ['container-issue', 'pack-material-issue', 'container-fill'];
  if (!last || !doc.stages.some((s) => s.steps.some((t) => PACK.includes(t.block.id)))) return;
  const at = doc.stages.length - 1;
  const of = (id: string) => last.steps.filter((t) => t.block.id === id);
  const material = (t: { settings: Record<string, SettingValue> }) => { const v = t.settings.material; return typeof v === 'object' && 'formula' in v ? v.formula : undefined; };
  if (!of('container-fill').length) error(`stages[${at}]`, `The last stage, ${last.name}, fills and labels the containers: it needs the Fill and label a container step (Pack and label)`, 'TA-26');
  for (const issue of of('pack-material-issue')) {
    const m = material(issue);
    if (m && !of('printed-reconciliation').some((r) => material(r) === m)) error(`stages[${at}]`, `The labels ${doc.formula.find((l) => l.key === m)?.name ?? m} issued in ${last.name} have no reconciliation step`, 'TA-26');
  }
  if (of('pack-material-issue').length && !of('destruction').length) error(`stages[${at}]`, `${last.name} issues labels: batch-coded leftovers need the destruction step`, 'TA-26');
}

/**
 * The formula (plan 3c.2): each line charged in a stage of this master, as a quantity per batch or per kg of the stage's
 * key input, or by molar equivalents of it (T28). The quantities are worked out now with neutral certificate values,
 * so a refusal of a template is fixed while the master is built.
 */
function formulaChecks(doc: MasterDoc, out: Problem[], error: (path: string, message: string, rule?: string) => void): void {
  const twice = (keys: string[], path: string) => keys.forEach((k, i) => keys.indexOf(k) !== i && error(`${path}[${i}]`, `The key ${k} is used twice`));
  twice(doc.formula.map((l) => l.key), 'formula');
  if (!doc.formula.length) error('formula', 'The formula has no materials', 'TA-01');
  doc.stages.forEach((s, si) => {
    const sm = doc.formula.filter((l) => l.stage === s.key && l.role === 'starting material');
    if (sm.length > 1) error(`stages[${si}]`, `Stage ${s.name} has ${sm.length} starting materials: one is the key input of the stage; the others are reagents`, 'TA-01');
  });
  doc.formula.forEach((l, i) => {
    const p = `formula[${i}]`;
    const before = out.length;
    if (!doc.stages.some((s) => s.key === l.stage)) return void error(`${p}.stage`, `${l.name} is charged in no stage of this master`, 'TA-01');
    if ((l.eq === undefined) === (l.quantity === undefined)) return void error(p, `${l.name}: give its quantity or its equivalents (one of them)`, 'TA-01');
    if (l.quantity !== undefined && !l.unit) return void error(`${p}.unit`, `${l.name}: give the unit of its quantity`, 'TA-01');
    if (l.role === 'starting material' && !(l.quantity && l.unit === 'kg')) error(p, `The starting material ${l.name} is the key input of its stage: give its quantity in kg`, 'TA-01');
    if (l.eq !== undefined && !l.mw) error(`${p}.mw`, `${l.name} is charged by equivalents: give its molecular weight (g/mol)`, 'TA-13');
    if (l.unit === 'L' && l.eq !== undefined && !l.density) error(`${p}.density`, `${l.name} is charged by equivalents as a volume: give its density (kg/L)`, 'TA-13');
    const k = l.eq !== undefined ? keyInput(doc, l.stage) : undefined;
    if (k && !k.mw) error(p, `${l.name} is charged by equivalents of ${k.name}: give the molecular weight of ${k.name}`, 'TA-13');
    const a = l.adjust;
    if (a?.potency && a.content) error(`${p}.adjust`, 'A line is adjusted for potency (T9) or for content (T18), not both');
    if (out.length > before) return;
    // The quantity worked out with neutral certificate values: a refusal of a template is fixed now.
    const r = lineQuantity(doc, [], HERE, l, true, { ...SAMPLE, content: a?.content?.nominalContent ?? SAMPLE.assay });
    if (!r.ok) error(a ? `${p}.adjust` : p, r.message, 'TA-13');
  });
  calculationChecks(doc, out);
}

const quantityOf = (text: string | undefined) => { const m = QUANTITY.exec(text ?? ''); const u = m && findUnit(m[3] ?? ''); return m && u ? { v: new Dec(m[1]!), u, text: text! } : undefined; };

// Calculation checks (owner decision of 15 November 2026). Not GMP rules: error-proofing of the calculations while the
// master is built. The refusals (water counted twice, potency as parent or element with a salt factor, molecules per
// salt unit, negative filler, IU or CFU as a mass) come from the templates through the formula checks above. These
// warnings need an answer, kept in the master document under their key; the answer counts while the warning reads the
// same as when it was answered.
// ICH Q3C Class 1 solvents.
const CLASS1 = /\b(benzene|carbon tetrachloride|1,2-dichloroethane|1,1-dichloroethene|1,1,1-trichloroethane)\b/i;
const WET = /\b(wet|cake|damp|solvent-wet)\b/i;
const SIZE = /\b(d\s?\(?0?\.?[159]0?\)?|d10|d50|d90|dv\d+|particle size|surface area|polymorph|crystal form)\b/i;

function calculationChecks(doc: MasterDoc, out: Problem[]): void {
  const ask = (path: string, key: string, message: string, options: string[], needsReason = false) => {
    const a = doc.answers?.[key];
    const ok = a && (a.about === message || a.about === plainWords(message)) && options.includes(a.choice) && (!needsReason || a.reason.trim() !== '');
    out.push({ level: 'warning', path, message, question: { key, options, needsReason, ...(ok ? { answer: a } : {}) } });
    return ok ? a.choice : undefined;
  };
  doc.formula.forEach((l, i) => {
    // ICH Q3C Class 1 (template test M8): a solvent to avoid; its use needs a reason and a residual-solvent test.
    if (CLASS1.test(l.name)) {
      ask(`formula[${i}]`, `class-1/${l.key}`, `${l.name} is an ICH Q3C Class 1 solvent, to be avoided in API manufacture. Confirm that it is needed, with the reason, and that the API is tested for it as a residual solvent.`, ['needed, tested'], true);
    }
    const salt = l.adjust?.salt;
    // A solvent-wet input weighed as if dry (F0204: about 23 % too little); answered, or corrected with the lot's solvent.
    const corrected = l.adjust?.potency?.basis === 'dried' || l.adjust?.potency?.basis === 'anhydrous and solvent-free' || l.adjust?.content?.formulaQuantityIs === 'wet';
    if (l.role === 'starting material' && WET.test(l.name) && !corrected) {
      ask(`formula[${i}]`, `solvent-wet/${l.key}`, `${l.name} looks solvent-wet: its quantity needs the lot's measured solvent content (an assay adjustment on the dried or solvent-free basis, or a content adjustment). Weighed as dry it gives too little (F0204: about 23 %). Is it weighed dry?`, ['weighed dry'], true);
    }
    // A salt factor written in the formula that differs from the molecular weights by more than 0.5 %
    const t11 = salt?.factor ? t11SaltFactor({ quantity: '1 kg', from: salt.from, to: salt.to }) : undefined;
    if (salt?.factor && t11?.ok) {
      const off = new Dec(salt.factor).minus(t11.factor).abs().div(t11.factor).times(100);
      if (off.gt('0.5')) {
          ask(`formula[${i}].adjust.salt`, `salt-factor/${l.key}`, `The salt factor ${salt.factor} written for ${l.name} differs by ${off.toFixed(1, Dec.ROUND_HALF_UP)} % from the molecular weights of ${salt.from.name} and ${salt.to.name} (factor ${t11.factor.toFixed(4, Dec.ROUND_HALF_UP)}), which the batch quantity uses. Confirm with a reason, or correct the factor or the molecular weights.`, ['confirmed'], true);
      }
    }
  });
  doc.stages.forEach((s, si) => s.steps.forEach((t, ti) => {
    const p = `stages[${si}].steps[${ti}]`;
    const limits = Object.entries(t.settings).filter((e): e is [string, Limit] => typeof e[1] === 'object' && 'unit' in e[1]);
    // A particle size, surface area or crystal form test needs both limits (F0490: Cmax 67.5-130 %).
    const words = Object.values(t.settings).filter((v): v is string => typeof v === 'string').join(' ') + ` ${t.instruction ?? ''}`;
    const oneSide = limits.find(([, l]) => (l.low === undefined) !== (l.high === undefined));
    if (oneSide && SIZE.test(words)) {
      ask(`${p}.settings.${oneSide[0]}`, `two-sided/${s.key}/${t.key}`, `Step ${t.key} tests particle size, surface area or crystal form with only ${oneSide[1].low === undefined ? 'an upper' : 'a lower'} limit: both sides can change how the API behaves in the medicine made from it (F0490: Cmax 67.5-130 % with the API's surface area). Confirm that one side is enough, with the reason, or add the other limit.`, ['one side is enough'], true);
    }
    // An order-critical step stays after the step it must follow (F0318: 37 % of the drug converted in the wrong order).
    if (t.orderAfter && !s.steps.slice(0, ti).some((x) => x.key === t.orderAfter)) {
      ask(p, `order/${s.key}/${t.key}`, `Step ${t.key} is order-critical: it must come after step ${t.orderAfter} in ${s.name}, and it no longer does. Put it back, or confirm the new order with the reason.`, ['new order confirmed'], true);
    }
  }));
}

/** Whether a step setting fits its kind, and a reference points at something earlier that exists. */
function settingProblem(doc: MasterDoc, si: number, ti: number, block: Block, bs: Block['settings'][number], settings: Record<string, SettingValue>, v: SettingValue): string | null {
  const kind = bs.kind;
  // A tolerance (notBatch, Tablets round 31) is typed: a formula line's batch quantity of some kilograms as the largest
  // change between rounds of drying would let every round pass as "no further change".
  if (bs.notBatch === 'tolerance' && typeof v === 'object' && !('unit' in v)) {
    const what = 'formula' in v ? `the batch quantity of ${doc.formula.find((l) => l.key === v.formula)?.name ?? v.formula}` : 'header' in v ? 'the batch size' : 'ref' in v ? `${v.ref} (an earlier step)` : 'the molar theoretical yield';
    return `${bs.label} is a tolerance: type it (${what} is not a tolerance)`;
  }
  if (typeof v === 'string') {
    if (kind === 'number') return DECIMAL.test(v) ? null : `"${v}" is not a plain decimal`;
    if (kind === 'quantity') {
      const m = QUANTITY.exec(v);
      return m && findUnit(m[3] ?? '') ? null : `"${v}" is not a number with a unit from the unit list`;
    }
    return kind === 'text' ? null : `A ${kind} cannot be written as text`;
  }
  if ('unit' in v) {
    if (kind !== 'limit') return `A limit is given where a ${kind} is wanted`;
    const r = c1WithinLimits({ value: { value: '0', unit: v.unit }, limit: v });
    return r.ok ? null : r.message;
  }
  if ('formula' in v) {
    if (kind !== 'material' && kind !== 'quantity') return `A formula line is given where a ${kind} is wanted`;
    const line = materialLines(doc).find((l) => l.key === v.formula);
    if (!line) return `No formula line ${v.formula}`;
    // A formula line gives its batch quantity in its own unit (kg, L, or a count; per kg of the key input or by
    // equivalents in kg or L): a setting of another known kind never takes it (Tablets round 31, where a line is a mass).
    const has = findUnit(line.unit === 'L/kg' ? 'L' : !line.unit || line.unit === 'kg/kg' ? 'kg' : line.unit)?.kind;
    const need = kind === 'quantity' ? neededKind(block, bs.name, settings) : undefined;
    return need && has && need !== has ? `${bs.label}: a formula line gives its batch quantity (${kindWords(has)}), but this step needs ${kindWords(need)}: type the value` : null;
  }
  if ('header' in v) return kind === 'quantity' ? null : `A header value is given where a ${kind} is wanted`;
  if ('molar' in v) {
    if (kind !== 'quantity') return `The molar theoretical yield is given where a ${kind} is wanted`;
    const r = molarTheoretical(doc, [], { stage: si, sub: 1, step: ti, round: 1 });
    return r.ok ? null : r.message;
  }
  const [sk, tk, name] = v.ref.split('/') as [string, string, string];
  const ri = doc.stages.findIndex((x) => x.key === sk);
  const target = doc.stages[ri];
  const rt = target?.steps.findIndex((t) => t.key === tk) ?? -1;
  if (!target || rt < 0) return `${v.ref}: no such stage and step`;
  if (ri > si || (ri === si && rt >= ti)) return `${v.ref} comes later than this step`;
  if (ri !== si && target.kind === 'sub-batch') return `${v.ref} is inside the sub-batch stage ${target.name}: refer to it from that stage only`;
  const b = findBlock(target.steps[rt]!.block);
  const names = b ? [...b.fields, ...b.calcs].map((x) => x.name) : [];
  if (!names.includes(name)) return `${v.ref}: step ${tk} has no field or calculation ${name}`;
  return null;
}
