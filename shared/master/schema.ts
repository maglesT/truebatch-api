/**
 * A master version is ONE JSON document: the header, the formula, and the stages in order with their steps in order.
 * This schema checks only its shape; whether it makes a good master is for checks.ts. A draft may be incomplete.
 */
import { z } from 'zod';

const decimal = z.string().regex(/^\d+(\.\d+)?$/, 'a plain decimal, e.g. "250.0"');
export const keySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lower-case letters, digits and -');
const text = (max = 200) => z.string().trim().max(max);

export const limitSchema = z.object({
  low: z.string().optional(), high: z.string().optional(), unit: z.string(),
  lowStrict: z.boolean().optional(), highStrict: z.boolean().optional(),
  alertLow: z.string().optional(), alertHigh: z.string().optional(),
}).strict();

// A step setting: a value as written ("0.5", "250.0 kg"), a limit, or a reference to an earlier step's field or
// calculation ("stage/step/name"), to a formula line (its batch quantity, adjusted when asked), to the header (the
// expected API in kg) or to the molar theoretical yield of the step's stage (T28).
export const HEADER_VALUES = ['batchSize'] as const;
export const settingValueSchema = z.union([
  text(),
  limitSchema,
  z.object({ ref: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+\/[a-zA-Z0-9]+$/, 'stage/step/name') }).strict(),
  z.object({ formula: keySchema, adjusted: z.boolean().optional() }).strict(),
  z.object({ header: z.enum(HEADER_VALUES) }).strict(),
  z.object({ molar: z.literal(true) }).strict(),
]);

const flowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  // Rounds of the same step until the stop check passes, at most maxRounds (then a deviation note is needed).
  z.object({ kind: z.literal('repeat-until'), maxRounds: z.number().int().min(1).max(500).optional(), stop: z.string().optional() }).strict(),
  z.object({ kind: z.literal('optional-with-reason') }).strict(),
  z.object({ kind: z.literal('qa-hold') }).strict(),
]);

export const stepSchema = z.object({
  key: keySchema,
  block: z.object({ id: z.string(), version: z.number().int().min(1) }).strict(),
  // The name people read (e.g. "Punch and die check — after compression"); without it, the block's name and material.
  name: text(120).optional(),
  instruction: text(4000).optional(),
  settings: z.record(z.string(), settingValueSchema).default({}),
  // The performer always signs; a second person checks when true.
  checker: z.boolean(),
  // The next step waits for the check (otherwise it opens when this step is done).
  waitForCheck: z.boolean().default(false),
  critical: z.boolean().default(false),
  minMinutes: z.number().int().positive().max(10_000).optional(),
  everyMinutes: z.number().int().positive().max(10_000).optional(),
  // F6 with a changing interval: after `afterMinutes` from the first round, a round every `everyMinutes` (F0030).
  everyMinutesLater: z.object({ afterMinutes: z.number().int().positive().max(10_000), everyMinutes: z.number().int().positive().max(10_000) }).strict().optional(),
  // F4 by a rule: the step is done only when the batch size is within the limit; otherwise it is not applicable, with
  // no operator choice.
  onlyIf: z.object({ header: z.enum(['batchSize']), limit: limitSchema }).strict().optional(),
  // Order-critical: this step must come after the step with this key in the same stage (F0318: the drug after the PVP).
  orderAfter: keySchema.optional(),
  flow: flowSchema.default({ kind: 'none' }),
  // Only trained people sign (owner, 17 Nov 2026): the skill Recruitment publishes (training_v1) that the performer and
  // the checker must hold, picked from Recruitment's list (typed only while the link is off). None: anyone may sign.
  training: z.object({ code: text(60).min(1), title: text(200).optional() }).strict().optional(),
}).strict();

export const stageSchema = z.object({
  key: keySchema,
  name: text().min(1),
  kind: z.enum(['normal', 'preparation', 'sub-batch']),
  count: z.number().int().min(2).max(50).optional(),
  roomTypes: z.array(text()).max(20).default([]),
  machineTypes: z.array(text()).max(50).default([]),
  role: text().default(''),
  // The intermediate the stage makes: its hold time, its molecular weight (T28: the molar theoretical yield, and the
  // equivalents of the stage that uses it), the quantity expected (kg: the planned input of the stage that uses it)
  // and the product molecules per molecule of the key input (default 1).
  produces: z.object({
    name: text().min(1), holdHours: z.number().positive().max(100_000).optional(),
    mw: decimal.optional(), expectedKg: decimal.optional(), perMol: decimal.optional(),
  }).strict().optional(),
  // Stages whose intermediate this stage uses (preparations must be closed first; their hold time ends here).
  uses: z.array(keySchema).max(20).default([]),
  steps: z.array(stepSchema).max(200),
}).strict();

const form = z.object({
  name: text().min(1), mw: decimal, moleculesPerUnit: z.number().int().min(1).optional(), hydrateOrSolvate: z.boolean().optional(),
  // The ion's charge, for a label claim in mEq (F0393).
  charge: z.number().int().min(1).max(4).optional(),
}).strict();

export const ROLES = ['starting material', 'reagent', 'solvent', 'catalyst', 'processing aid', 'packing material'] as const;
// The units of a formula line's quantity: per batch (kg, L, or a count of units: drums, liners, labels), or per kg of
// the stage's key input ("volumes").
export const LINE_UNITS = ['kg', 'L', 'units', 'L/kg', 'kg/kg'] as const;
/**
 * A formula line (TrueBatch API, plan 3c.2): one material charged in one stage, as a quantity per batch (kg or L), per
 * kg of the stage's key input, or in molar equivalents of the key input (T28). The key input of a stage is its
 * starting material, or the intermediate of the stage it uses (that needs no line).
 */
export const lineSchema = z.object({
  key: keySchema,
  materialItemId: z.string().min(1).max(100),
  code: text(),
  name: text(),
  stage: keySchema,
  role: z.enum(ROLES),
  quantity: decimal.optional(),
  unit: z.enum(LINE_UNITS).optional(),
  eq: decimal.optional(),
  // g/mol: of the starting material (its moles), of a line charged by equivalents.
  mw: decimal.optional(),
  // kg/L: a liquid charged by volume.
  density: decimal.optional(),
  // TA-24: a solvent the master allows to be charged recovered too: the recovered material of master data (its own
  // code, tested and released in MMS); the step takes a lot of either, and solvent sent to recovery becomes a lot of it.
  recovered: z.object({ materialItemId: z.string().min(1).max(100), code: text(), name: text() }).strict().optional(),
  // Settings of the adjustment templates, applied in this order: T11 salt factor, T9 potency or T18 content, T16 overage.
  adjust: z.object({
    // `factor`: the salt factor as written; only checked against the molecular weights, never used.
    salt: z.object({ from: form, to: form, factor: decimal.optional() }).strict().optional(),
    potency: z.object({
      basis: z.enum(['as is', 'anhydrous', 'dried', 'ignited', 'anhydrous and solvent-free']),
      standardIs: z.enum(['anhydrous', 'hydrate or solvate']).optional(),
      assayExpressedAs: z.enum(['anhydrous substance', 'hydrate']).optional(),
      potencyAs: z.enum(['parent', 'element']).optional(),
      assayAbove100: z.enum(['use', 'treat as 100']).optional(),
    }).strict().optional(),
    content: z.object({
      formulaQuantityIs: z.enum(['dry', 'wet']), nominalContent: z.string().optional(), contentSource: z.enum(['certificate', 'in-process result']).optional(),
      resultType: z.enum(['content', 'percent of theoretical']).optional(),
    }).strict().optional(),
    overage: z.object({ percent: decimal, maxPercent: decimal.optional() }).strict().optional(),
  }).strict().optional(),
}).strict();

/** The API master's header (plan 3c.1): the API as a material of master data, the API expected in kg, its retest period. */
export const headerSchema = z.object({
  productItemId: z.string().min(1).max(100),
  productCode: text(),
  productName: text(),
  batchSize: decimal,
  // g/mol of the API as isolated (salt, hydrate): the molar theoretical yield of the last stage (T28).
  mw: decimal.optional(),
  // TA-27: the retest date is the date of manufacture + this period, never typed.
  retestMonths: z.number().int().min(1).max(120),
  // A master of one step of a route whose intermediate goes to stores (plan question 2): its lot is an intermediate
  // lot in output_lot_v1, not an API lot.
  intermediate: z.boolean().optional(),
  // TA-11: the rooms of master data (codes) where the materials are weighed.
  dispensingRooms: z.array(text()).max(20).optional(),
}).strict();

// The author's answer to a calculation warning (checks.ts), keyed by the warning and its item. `about` is the warning
// as answered: when the warning reads differently (the item changed), it needs a new answer.
export const answerSchema = z.object({ about: text(1000), choice: text().min(1), reason: text(1000) }).strict();

export const masterSchema = z.object({
  header: headerSchema,
  formula: z.array(lineSchema).max(100),
  stages: z.array(stageSchema).max(50),
  answers: z.record(z.string().max(120), answerSchema).optional(),
}).strict();

export type MasterDoc = z.infer<typeof masterSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Step = z.infer<typeof stepSchema>;
export type FormulaLine = z.infer<typeof lineSchema>;
export type SettingValue = z.infer<typeof settingValueSchema>;
export type Limit = z.infer<typeof limitSchema>;
export type Answer = z.infer<typeof answerSchema>;

/** Every material a step may name: the formula lines. */
export const materialLines = (doc: MasterDoc): FormulaLine[] => doc.formula;

export const MASTER_STATES = ['draft', 'in_review', 'approved', 'effective', 'retired'] as const;
export type MasterState = (typeof MASTER_STATES)[number];
