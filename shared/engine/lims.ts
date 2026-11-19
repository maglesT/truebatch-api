/**
 * Medhanta LIMS (readers round 2, Tablets round 40): QC's certificate of analysis (CoA), read live from LIMS's published
 * view coa_v1. Where QC approves the batch, or a lot typed by hand names its QC report number, the CoA is PICKED from
 * LIMS while the link answers and keeps the LIMS reference (the CoA number). Absent or down, it is typed by hand as
 * before. Fixed rules, checked once here:
 * - only an APPROVED CoA counts (a rejected one, or one LIMS later rejected, is never pickable);
 * - it is of this batch (the batch number and the API) or of this lot (the lot number and the line's material); a CoA
 *   of another batch, lot or material is refused. In API the API is a material of master data (header.productItemId),
 *   so LIMS samples an API batch as a MATERIAL sample whose lot number is the batch number;
 * - a batch's CoA is of a release sample (not stability or an investigation); a lot's of a release or retest sample.
 * (Tablets also picks a step's QC result from result_v1; no API step records a result of the release CoA.)
 * Tablets round 42 (owner: in-process lab tests are picked, not typed): a step with an in-process QC field (block field
 * flag qc 'in_process') opens a lab request when it starts, published as report.lab_request_v1 ('<batch>/<step key>').
 * Its field picks the reported figure of a result of an APPROVED in-process report (purpose in_process, an IPR number) of
 * THAT request: of this batch and API, this step. API's in-process fields are single results (no lists of readings).
 */
import type { BlockField } from '../blocks/format.js';

/** A row of LIMS coa_v1, as read. `rejected`: LIMS has a rejection of the same sample too. */
export interface Coa {
  coaId: string; coaNumber: string | null; sampleNumber: string; lotNumber: string | null; itemKind: string | null;
  itemMasterId: string | null; itemCode: string | null; itemName: string | null; purpose: string | null; decision: string;
  decidedAt: string | null; decidedBy: string | null; specNumber: string | null; specVersion: number | null; rejected?: boolean;
  /** The lab request of an in-process sample (lab_request_v1.request_id); null for other purposes. */
  requestId?: string | null;
}
/** A row of LIMS result_v1 of an approved CoA, as read; `reported` is the figure as reported (null before LIMS kept it). */
export interface QcResult {
  resultId: string; coaId: string; coaNumber: string | null; testName: string | null; reported: string | null; unit: string | null;
  limitText: string | null; analysisNumber: string | null; outsideLab: string | null;
  /** The lab request (in-process), the individual values in LIMS's order (null when not individual), and what `reported`
   * is: 'mean' | 'AV' | 'result' (null from a LIMS without the column). */
  requestId?: string | null; individual?: string[] | null; figure?: string | null;
  /** Tablets round 44: the TrueBatch field an in-process result answers (result_v1.ipc_field; null from an older LIMS). */
  ipcField?: string | null;
}
/** What the CoA must be of: this batch (of the API), or this lot of the step's material. */
export type CoaFor =
  | { kind: 'BATCH'; batchNo: string; itemId: string; code: string; request?: string }
  | { kind: 'LOT'; lot: string; materialId?: string; materialCode?: string };

const same = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
const PURPOSES: Record<CoaFor['kind'], string[]> = { BATCH: ['release'], LOT: ['release', 'retest'] };

/** Why this CoA may not be used for `want`, in plain words; null when it may. */
export function coaRefusal(c: Coa, want: CoaFor): string | null {
  const no = c.coaNumber ?? `of sample ${c.sampleNumber}`;
  const what = want.kind === 'BATCH' ? `batch ${want.batchNo}` : `lot ${want.lot}`;
  if (c.decision !== 'APPROVED' || c.rejected || !c.coaNumber) return `CoA ${no} is not approved in LIMS (${c.decision.toLowerCase()}): only an approved CoA may be used.`;
  if (c.itemKind !== 'MATERIAL') return `CoA ${no} is of a ${(c.itemKind ?? 'other').toLowerCase()} sample, not of ${what}.`;
  if (!same(c.lotNumber, want.kind === 'BATCH' ? want.batchNo : want.lot)) return `CoA ${no} is for ${want.kind === 'BATCH' ? 'batch' : 'lot'} ${c.lotNumber ?? '—'}, not ${what}.`;
  const [id, code] = want.kind === 'BATCH' ? [want.itemId, want.code] : [want.materialId, want.materialCode];
  if (id && c.itemMasterId && c.itemMasterId !== id) return `CoA ${no} is of ${c.itemCode ?? 'another material'}, not ${code ?? 'the material of this step'}.`;
  // An in-process field takes only an in-process report of this step's own request.
  if (want.kind === 'BATCH' && want.request !== undefined) {
    if (c.purpose !== 'in_process') return `CoA ${no} is of a ${c.purpose ?? 'other'} sample: only an in-process report of request ${want.request} (this step) may be used.`;
    if (!requestFits(c.requestId, want.request)) return `In-process report ${no} is for request ${c.requestId ?? '—'}, not request ${want.request} (this step) or an earlier round of it.`;
    return null;
  }
  if (!PURPOSES[want.kind].includes(c.purpose ?? '')) return `CoA ${no} is of a${c.purpose === 'in_process' ? 'n' : ''} ${(c.purpose ?? 'other').replace(/_/g, '-')} sample: only the ${PURPOSES[want.kind].join(' or ')} CoA of ${what} may be used.`;
  return null;
}

/** The CoA as the step, the review and the PDF show it (kept with the record as the source's `shown`). */
export const coaText = (c: Coa) => `LIMS CoA ${c.coaNumber}: sample ${c.sampleNumber}${c.itemCode ? `, ${c.itemCode}` : ''}${c.lotNumber ? ` ${c.lotNumber}` : ''}, approved${c.decidedBy ? ` by ${c.decidedBy}` : ''}${c.specNumber ? `, specification ${c.specNumber}${c.specVersion ? ` v${c.specVersion}` : ''}` : ''}`;

const NUMBER = /^-?\d+(\.\d+)?$/;
/**
 * Tablets round 41: the same unit written two ways is one unit. A LIMS result and a step field may write a unit
 * differently (a pH result carries no unit in LIMS; "mL" and "ml"; spaces). Only spelling is forgiven: the letters of
 * the unit must still be the same (mg against %, ppm against %, never match).
 */
export function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (u: string | null | undefined) => {
    const x = (u ?? '').trim().replace(/[\s·.⋅]/g, '').toLowerCase();
    return x === 'ph' ? '' : x;
  };
  return norm(a) === norm(b);
}
/** The answer that picks a LIMS result for a field (the step screen sends it in place of a typed number). */
export const isPick = (x: unknown): x is { lims: string } => !!x && typeof x === 'object' && !Array.isArray(x) && typeof (x as { lims?: unknown }).lims === 'string';

// ---- In-process lab requests and their results (Tablets round 42).

/** The lab request of a step instance: '<batch number>/<step key>' (a repeated round or sub-batch has its own key). */
export const labRequestId = (batchNo: string, key: string) => `${batchNo}/${key}`;
/** A request id's step (batch and stage.sub-batch.step, without case) and round; null when it is not one. */
export function requestRound(id: string | null | undefined): { step: string; round: number } | null {
  const m = /^(.+\/\d+\.\d+\.\d+)\.(\d+)$/.exec((id ?? '').trim());
  return m ? { step: m[1]!.toLowerCase(), round: Number(m[2]) } : null;
}
/**
 * Round 43 (general rule, found by API's periodic reactions): a step takes an in-process report of its own request or of
 * an EARLIER round of the same step. A sample taken in round 3 is often approved while the rounds go on: the decision in
 * round 5 uses it (the record says which round it was sampled in). A later round's sample never fills an earlier round,
 * and a step without rounds (round 1) takes only its own request. Whether another round picked it already is the
 * server's (pull.ts: one result fills one round).
 */
export function requestFits(candidate: string | null | undefined, want: string): boolean {
  const c = requestRound(candidate);
  const w = requestRound(want);
  return !!c && !!w && c.step === w.step && c.round <= w.round;
}
/** A test of a lab request, as lab_request_v1.tests lists it. individual: the number of values (a list), else null. */
export interface LabTest { name: string; label: string; unit: string; individual: number | null }
/**
 * The in-process QC fields of a step, as the tests of its lab request (`unitOf`: the field's unit in this step). Round
 * 43: a field whose unit the master did not set is not asked for (a reaction with a TLC or visual end point and no IPC
 * unit opens no request).
 */
export const labTests = (fields: readonly BlockField[], unitOf: (f: BlockField) => string): LabTest[] =>
  fields.filter((f) => f.qc === 'in_process' && unitOf(f)).map((f) => ({ name: f.name, label: f.label, unit: unitOf(f), individual: f.count ?? null }));

/**
 * Tablets round 44: whether a result may fill field `f`: a result that names no field (an older LIMS) may fill any field
 * in its unit; one that names a field (result_v1.ipc_field) fills only that field, so in a step with several fields in
 * one unit a result of one test never goes into another. (Tablets also lets a staged list fill either stage; API has none.)
 */
export const answersField = (r: Pick<QcResult, 'ipcField'>, f: BlockField) => !r.ipcField || r.ipcField === f.name;
/** Why this result may not fill field `f` (it answers another field of `fields`), in plain words; null when it may. */
export function fieldRefusal(r: Pick<QcResult, 'ipcField' | 'testName' | 'coaNumber'>, f: BlockField, fields: readonly BlockField[]): string | null {
  if (answersField(r, f)) return null;
  const label = fields.find((x) => x.name === r.ipcField)?.label ?? r.ipcField;
  return `${r.testName ?? 'The result'} of report ${r.coaNumber ?? '—'} answers ${label}, not ${f.label}.`;
}

const FIGURE: Record<string, string> = { mean: 'mean', AV: 'acceptance value', result: 'result' };
/**
 * An in-process result as the step, the review and the PDF show it (kept with the record as the source's `shown`):
 * the request it was sampled for, and (round 43) the round and time that request opened, when it is a step with rounds.
 */
export const inProcessText = (r: QcResult, request: string, sampled?: { round?: number; at?: string }) => `LIMS in-process report ${r.coaNumber}: ${r.testName ?? 'result'} (request ${request}`
  + `${sampled?.round ? `, sampled in round ${sampled.round}` : ''}${sampled?.at ? `${sampled.round ? ' at' : ', requested'} ${sampled.at}` : ''})`
  + `${r.reported ? `, ${r.reported}${r.unit ? ` ${r.unit}` : ''} as reported` : ''}${r.limitText ? ` (limit ${r.limitText})` : ''}`
  + `${r.analysisNumber ? `, analysis ${r.analysisNumber}` : ''}${r.outsideLab ? `, outside lab ${r.outsideLab}` : ''}`;

/**
 * What an in-process result gives a field: the reported figure, by field name, or why it may not (in plain words). API's
 * in-process fields are single results: a list of values, or a mean or acceptance value, is not one result. Its CoA and
 * request are checked by coaRefusal. (Tablets' inProcessFit also fills lists of readings; API has none.)
 */
export function inProcessFit(r: Pick<QcResult, 'testName' | 'coaNumber' | 'unit' | 'reported' | 'individual' | 'figure' | 'ipcField'>, f: BlockField, unit: string, fields: readonly BlockField[] = [f]):
  { error: string } | { take: Record<string, string> } {
  const what = `${r.testName ?? 'The result'} of in-process report ${r.coaNumber ?? '—'}`;
  // Round 44: a result that names the field it answers fills only that field.
  const other = fieldRefusal(r, f, fields);
  if (other) return { error: other };
  if (!sameUnit(r.unit, unit)) return { error: `${what} is in ${r.unit || 'no unit'}, not in ${unit}.` };
  if (r.individual?.length) return { error: `${what} is a list of ${r.individual.length} values: ${f.label} takes one result.` };
  if (r.figure && r.figure !== 'result') return { error: `${what} reports the ${FIGURE[r.figure] ?? r.figure}, not one result: it is not ${f.label}.` };
  if (!r.reported || !NUMBER.test(r.reported.trim())) return { error: `${what} has no reported figure in LIMS.` };
  return { take: { [f.name]: r.reported.trim() } };
}
