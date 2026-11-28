import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Sql } from '../server/db.js';
import { links } from '../server/links.js';
import { coaRefusal, type Coa } from '../shared/engine/lims.js';
import { qcReportText } from '../shared/engine/release.js';
import { batchRecordDoc } from '../server/batch-record.js';
import { loadBatch, recordInput } from '../server/routes/batches.js';
import { call, freshApp, handLabels, login, proofFor, seedUser, TEST_DATABASE_URL, type TestApp } from './helpers.js';
import { small } from './engine-fixture.js';

// Readers round 2 (Tablets round 40): QC's certificate of analysis (CoA) from Medhanta LIMS (coa_v1), read through a
// fake LIMS schema in the test database with TrueBatch API's restricted login, as on the platform. While LIMS answers,
// the batch's QC approval and the QC report of a lot typed by hand are PICKED from an approved CoA of this batch or lot;
// absent or down, they are typed by hand as before. In API the API is a material of master data, so LIMS samples a
// batch as a MATERIAL sample whose lot number is the batch number.

const coa = (o: Partial<Coa> = {}): Coa => ({ coaId: 'c1', coaNumber: 'COA26001', sampleNumber: 'LS26001', lotNumber: 'TA260001', itemKind: 'MATERIAL', itemMasterId: 'p',
  itemCode: 'P', itemName: 'P', purpose: 'release', decision: 'APPROVED', decidedAt: '2026-11-19T06:00:00Z', decidedBy: 'QC ONE', specNumber: 'SPEC-P', specVersion: 1, ...o });
const batch = { kind: 'BATCH' as const, batchNo: 'TA260001', itemId: 'p', code: 'P' };
const lot = { kind: 'LOT' as const, lot: 'LOT-1', materialId: 'm', materialCode: 'M' };

describe('the LIMS rules (shared/engine/lims.ts): only an approved CoA of this batch or lot', () => {
  it('TA-21 an approved release CoA of this batch, of the API, may be used; the batch number without case', () => {
    expect(coaRefusal(coa(), batch)).toBeNull();
    expect(coaRefusal(coa({ lotNumber: 'ta260001 ' }), batch)).toBeNull();
  });

  it.each([
    ['rejected', { decision: 'REJECTED', coaNumber: null }, 'CoA of sample LS26001 is not approved in QLIMS (rejected): only an approved CoA may be used.'],
    ['approved, then rejected', { rejected: true }, 'CoA COA26001 is not approved in QLIMS (approved): only an approved CoA may be used.'],
    ['of another batch', { lotNumber: 'TA260002' }, 'CoA COA26001 is for batch TA260002, not batch TA260001.'],
    ['of another material', { itemMasterId: 'q', itemCode: 'Q' }, 'CoA COA26001 is of Q, not P.'],
    ['of a product sample', { itemKind: 'PRODUCT' }, 'CoA COA26001 is of a product sample, not of batch TA260001.'],
    ['of a stability sample', { purpose: 'stability' }, 'CoA COA26001 is of a stability sample: only the release CoA of batch TA260001 may be used.'],
  ] as [string, Partial<Coa>, string][])('TA-21 a CoA %s may not be used', (_, o, why) => {
    expect(coaRefusal(coa(o), batch)).toBe(why);
  });

  it('TA-12 a lot\'s CoA: approved, of this lot and the step\'s material, of a release or retest sample', () => {
    const m = (o: Partial<Coa> = {}) => coa({ lotNumber: 'LOT-1', itemMasterId: 'm', itemCode: 'M', ...o });
    expect(coaRefusal(m(), lot)).toBeNull();
    expect(coaRefusal(m({ purpose: 'retest' }), lot)).toBeNull();
    expect(coaRefusal(m({ itemMasterId: 'x', itemCode: 'X' }), lot)).toBe('CoA COA26001 is of X, not M.');
    expect(coaRefusal(m({ lotNumber: 'LOT-2' }), lot)).toBe('CoA COA26001 is for lot LOT-2, not lot LOT-1.');
    expect(coaRefusal(m({ decision: 'REJECTED' }), lot)).toMatch(/not approved in QLIMS/);
  });

  it('QC approval\'s report in words: from LIMS, or typed by hand', () => {
    expect(qcReportText({ reportNo: 'COA26001', source: { from: 'lims', asOf: null, shown: 'QLIMS CoA COA26001: sample LS26001' } })).toBe('QC report COA26001 (QLIMS CoA COA26001: sample LS26001)');
    expect(qcReportText({ reportNo: 'QC-1', source: { from: 'hand', link: 'lims', state: 'down' } })).toBe('QC report QC-1 (typed by hand: QLIMS link down)');
    expect(qcReportText({ reportNo: 'QC-1' })).toBe('QC report QC-1');
  });
});

let t: TestApp;
let provider: Sql;
let L = '';
const cookies: Record<string, string> = {};

beforeAll(async () => {
  t = await freshApp(async (db) => {
    L = `${db.schema}_lims`;
    // LIMS's published view, as a table with the same columns (db/migrations 0009, 0022 of LIMS).
    await db.owner.unsafe(`
      create schema ${L};
      create table ${L}.coa_v1 (coa_id uuid, coa_number text, sample_number text, lot_number text, item_kind text, item_master_id text, item_code text,
        item_name text, purpose text, decision text, decided_at timestamptz, decided_by text, spec_number text, spec_version int, reason text,
        read_at timestamptz default now(), data_as_of timestamptz default now());
      grant usage on schema ${L} to truebatch_api_app;
      grant select on all tables in schema ${L} to truebatch_api_app;`);
    provider = connect(TEST_DATABASE_URL, { role: 'truebatch_api_app', link: true });
    return links({ lims: provider }, { lims: L });
  });
  const item = (itemId: string, code: string, name: string) => ({ itemId, code, name, version: 1, active: true });
  t.master.materials_.push({ ...item('p', 'P', 'P'), category: 'API', unit: 'kg' });
  t.master.materials_.push({ ...item('m', 'M', 'M'), category: null, unit: 'kg' });
  t.master.equipment_.push({ ...item('eq-bal', 'BAL-01', 'Balance'), kind: 'instrument', type: 'balance', room: 'DSP-01' });
  const people = { author: ['truebatch_api.master.author'], issuer: ['truebatch_api.batch.issue'], asha: ['truebatch_api.batch.operate', 'truebatch_api.batch.check'],
    quinn: ['truebatch_api.qc.approve'] } as const;
  for (const [name, perms] of Object.entries(people)) {
    await seedUser(t.owner, name, [...perms]);
    cookies[name] = (await login(t.app, name)).cookie;
  }
});
afterAll(async () => {
  await provider?.end();
  if (L) await t.owner.unsafe(`drop schema if exists ${L} cascade`);
  await t?.close();
});

const as = (who: string, method: 'GET' | 'POST', url: string, body?: object) => call(t.app, cookies[who]!, method, url, body);
const cut = () => t.owner.unsafe(`revoke select on all tables in schema ${L} from truebatch_api_app`);
const restore = () => t.owner.unsafe(`grant select on all tables in schema ${L} to truebatch_api_app`);
async function issue(steps: object[]) {
  const yieldStep = { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } };
  const res = await as('author', 'POST', '/api/masters', { doc: small([{ steps: [...steps, yieldStep] }]) });
  expect(res.statusCode, res.body).toBe(200);
  const { id } = res.json() as { id: number };
  for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${id}`;
  const b = await as('issuer', 'POST', '/api/batches', { masterVersionId: id, proof: proofFor('issuer') });
  expect(b.statusCode, b.body).toBe(200);
  return b.json() as { id: number; batchNo: string };
}
type StepJson = { id: string; values: Record<string, unknown>; source: Record<string, { from: string; state?: string; link?: string; shown?: string }> };
const stepOf = async (id: number, key: string) => ((await as('asha', 'GET', `/api/batches/${id}`)).json() as { steps: StepJson[] }).steps.find((s) => s.id === key)!;
const record = (id: number, values: object) => as('asha', 'POST', `/api/batches/${id}/steps/0.1.0.1/record`, { values });
const problems = async (p: ReturnType<typeof record>) => ((await p).json() as { problems: string[] }).problems;
/** A decided LIMS sample of `lotNo` (by default a release sample of the API, approved). */
let n = 0;
async function decided(lotNo: string, o: { kind?: string; item?: string; code?: string; purpose?: string; decision?: string } = {}) {
  n += 1;
  const number = `COA26${String(n).padStart(3, '0')}`;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const decision = o.decision ?? 'APPROVED';
  await t.owner.unsafe(`insert into ${L}.coa_v1 (coa_id, coa_number, sample_number, lot_number, item_kind, item_master_id, item_code, item_name, purpose, decision, decided_at, decided_by, spec_number, spec_version)
    values ($1, $2, $3, $4, $5, $6, $7, 'Item', $8, $9, now(), 'QC ONE', 'SPEC-1', 2)`,
  [id, decision === 'APPROVED' ? number : null, `LS26${String(n).padStart(3, '0')}`, lotNo, o.kind ?? 'MATERIAL', o.item ?? 'p', o.code ?? 'P', o.purpose ?? 'release', decision]);
  return number;
}
type Picks = { link: string; coas: { coaNumber: string; shown: string }[] };
const picks = async (id: number, q: string) => (await as('asha', 'GET', `/api/batches/${id}/lims${q}`)).json() as Picks;

describe('QC approval of the batch with its CoA from LIMS', () => {
  let b: { id: number; batchNo: string };
  let good = '';
  beforeAll(async () => {
    b = await issue([{}]);
    // The record is complete and production approved (the steps' own tests are elsewhere): its event, as the route writes it.
    await t.owner`insert into batch_events (batch_id, kind, payload, person_id) values (${b.id}, 'production_approved', '{}', (select id from users where username = 'asha'))`;
    good = await decided(b.batchNo);
    await decided(b.batchNo, { decision: 'REJECTED' });
    await decided(b.batchNo, { purpose: 'stability' });
    await decided(b.batchNo, { item: 'q', code: 'Q' });
    await decided('TA269998');
  });
  const approve = async (reportNo: string) => as('quinn', 'POST', `/api/batches/${b.id}/qc-approve`,
    { proof: proofFor('quinn'), reportNo, contentHash: ((await as('quinn', 'GET', `/api/batches/${b.id}`)).json() as { batch: { contentHash: string } }).batch.contentHash });

  it('TA-21 QC picks the approved release CoA of this batch of the API: only it is offered', async () => {
    const p = await picks(b.id, '');
    expect(p.link).toBe('ok');
    expect(p.coas.map((c) => c.coaNumber)).toEqual([good]);
    expect(p.coas[0]!.shown).toBe(`QLIMS CoA ${good}: sample LS26${good.slice(5)}, P ${b.batchNo}, approved by QC ONE, specification SPEC-1 v2`);
  });

  it('TA-21 while LIMS answers, a number that is not an approved CoA of this batch there is refused, with the reason', async () => {
    expect((await approve('QC-26-0042')).json()).toMatchObject({ error: 'not_in_lims', problems: [`QC-26-0042 is not an approved CoA of batch ${b.batchNo} in QLIMS: pick one.`] });
    const stability = `COA26${String(Number(good.slice(5)) + 2).padStart(3, '0')}`;
    expect((await approve(stability)).json()).toMatchObject({ error: 'not_in_lims', problems: [`CoA ${stability} is of a stability sample: only the release CoA of batch ${b.batchNo} may be used.`] });
    const other = `COA26${String(Number(good.slice(5)) + 4).padStart(3, '0')}`;
    expect((await approve(other)).json()).toMatchObject({ error: 'not_in_lims', problems: [`${other} is not an approved CoA of batch ${b.batchNo} in QLIMS: pick one.`] });
  });

  it('TA-21 the picked CoA is kept with the approval (signed with it), on the release screen and in the PDF', async () => {
    const r = await approve(good.toLowerCase());
    expect(r.statusCode, r.body).toBe(200);
    const [e] = await t.owner<{ payload: { reportNo: string; source: { from: string; shown: string } } }[]>`select payload from batch_events where batch_id = ${b.id} and kind = 'qc_approved'`;
    // The CoA number as LIMS writes it.
    expect(e!.payload).toMatchObject({ reportNo: good, source: { from: 'lims', shown: expect.stringContaining(`QLIMS CoA ${good}`) } });
    const l = (await loadBatch(t.sql, b.id))!;
    const pdf = JSON.stringify(batchRecordDoc(await recordInput(t.sql, l, t.master), 'QUINN', new Date(), false));
    expect(pdf).toContain(`QC report ${good} (QLIMS CoA ${good}`);
  });

  it('TA-21 LIMS absent or down: the QC report number is typed, marked typed by hand', async () => {
    const c = await issue([{}]);
    await t.owner`insert into batch_events (batch_id, kind, payload, person_id) values (${c.id}, 'production_approved', '{}', (select id from users where username = 'asha'))`;
    await cut();
    try {
      expect((await picks(c.id, '')).link).toBe('down');
      const hash = ((await as('quinn', 'GET', `/api/batches/${c.id}`)).json() as { batch: { contentHash: string } }).batch.contentHash;
      const r = await as('quinn', 'POST', `/api/batches/${c.id}/qc-approve`, { proof: proofFor('quinn'), reportNo: 'QC-26-0042', contentHash: hash });
      expect(r.statusCode, r.body).toBe(200);
    } finally { await restore(); }
    const [e] = await t.owner<{ payload: object }[]>`select payload from batch_events where batch_id = ${c.id} and kind = 'qc_approved'`;
    expect(e!.payload).toEqual({ reportNo: 'QC-26-0042', source: { from: 'hand', link: 'lims', state: 'down' } });
  });
});

describe('the QC report of a lot typed by hand, picked from LIMS', () => {
  const weigh = { block: { id: 'weigh', version: 1 }, checker: true, settings: { target: { formula: 'x' }, tolerance: '1.0' } };
  let b: { id: number; batchNo: string };
  let good = '';
  let other = '';
  beforeAll(async () => {
    b = await issue([weigh]);
    await as('asha', 'POST', `/api/batches/${b.id}/steps/0.1.0.1/start`, {});
    good = await decided('LOT-1', { item: 'm', code: 'M' });
    other = await decided('LOT-1', { item: 'x', code: 'X' });
  });

  it('TA-12 MMS not linked, LIMS answers: the lot\'s QC report is an approved CoA of this lot and material in LIMS', async () => {
    expect((await record(b.id, { lot: 'LOT-1', ...handLabels('lot', 'lot') })).statusCode).toBe(200);
    expect((await picks(b.id, '?key=0.1.0.1&lot=LOT-1')).coas.map((c) => c.coaNumber)).toEqual([good]);
    expect(await problems(record(b.id, { 'lot.report': 'SUP-123' }))).toEqual(['SUP-123 is not an approved CoA of lot LOT-1 in QLIMS: pick one.']);
    expect(await problems(record(b.id, { 'lot.report': other }))).toEqual([`CoA ${other} is of X, not M.`]);
    expect((await record(b.id, { 'lot.report': good.toLowerCase() })).statusCode).toBe(200);
    const s = await stepOf(b.id, '0.1.0.1');
    expect(s.values['lot.report']).toBe(good);
    expect(s.source['lot.report']).toMatchObject({ from: 'lims', shown: expect.stringContaining(`QLIMS CoA ${good}: sample`) });
    expect(s.source.lot).toEqual({ from: 'hand', link: 'mms', state: 'absent' });
  });

  it('TA-12 LIMS down too: the QC report number is typed as before', async () => {
    await cut();
    try { expect((await record(b.id, { 'lot.report': 'SUP-123' })).statusCode).toBe(200); } finally { await restore(); }
    const s = await stepOf(b.id, '0.1.0.1');
    expect(s.values['lot.report']).toBe('SUP-123');
    expect(s.source['lot.report']).toEqual({ from: 'hand', link: 'lims', state: 'down' });
  });
});
