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
 */

/** A row of LIMS coa_v1, as read. `rejected`: LIMS has a rejection of the same sample too. */
export interface Coa {
  coaId: string; coaNumber: string | null; sampleNumber: string; lotNumber: string | null; itemKind: string | null;
  itemMasterId: string | null; itemCode: string | null; itemName: string | null; purpose: string | null; decision: string;
  decidedAt: string | null; decidedBy: string | null; specNumber: string | null; specVersion: number | null; rejected?: boolean;
}
/** What the CoA must be of: this batch (of the API), or this lot of the step's material. */
export type CoaFor =
  | { kind: 'BATCH'; batchNo: string; itemId: string; code: string }
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
  if (!PURPOSES[want.kind].includes(c.purpose ?? '')) return `CoA ${no} is of a ${c.purpose ?? 'other'} sample: only the ${PURPOSES[want.kind].join(' or ')} CoA of ${what} may be used.`;
  return null;
}

/** The CoA as the step, the review and the PDF show it (kept with the record as the source's `shown`). */
export const coaText = (c: Coa) => `LIMS CoA ${c.coaNumber}: sample ${c.sampleNumber}${c.itemCode ? `, ${c.itemCode}` : ''}${c.lotNumber ? ` ${c.lotNumber}` : ''}, approved${c.decidedBy ? ` by ${c.decidedBy}` : ''}${c.specNumber ? `, specification ${c.specNumber}${c.specVersion ? ` v${c.specVersion}` : ''}` : ''}`;
