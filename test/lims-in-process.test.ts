import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Sql } from '../server/db.js';
import { links } from '../server/links.js';
import { findBlock, labelled } from '../shared/blocks/index.js';
import { blockProblems, type Block, type BlockField } from '../shared/blocks/format.js';
import { answersField, coaRefusal, fieldRefusal, inProcessFit, inProcessText, ipcCodes, labTests, requestFits, sameUnit, type Coa, type QcResult } from '../shared/engine/lims.js';
import { labRequestOf, loadBatch, recordInput } from '../server/routes/batches.js';
import { batchRecordDoc } from '../server/batch-record.js';
import { handWhy } from '../shared/engine/links.js';
import { qcReportText } from '../shared/engine/release.js';
import { call, freshApp, login, proofFor, seedUser, TEST_DATABASE_URL, type TestApp } from './helpers.js';
import { api, small } from './engine-fixture.js';
import { masterChecks } from '../shared/master/checks.js';

// Tablets round 42 (owner: in-process lab tests are picked from LIMS, not typed) and round 43 (found here: a periodic
// step's rounds). A step with an in-process QC field opens a lab request when it starts (report.lab_request_v1); its
// field picks the reported figure of an approved in-process report of that request, or of an EARLIER round of the same
// step (a sample of round 1 approved while round 2 runs), each result filling one round. LIMS's views are stand-in tables
// in their own schema, read with TrueBatch API's restricted login as on the platform.

const coa = (o: Partial<Coa> = {}): Coa => ({ coaId: 'c1', coaNumber: 'IPR26001', sampleNumber: 'LS26001', lotNumber: 'TA260001', itemKind: 'MATERIAL', itemMasterId: 'p',
  itemCode: 'P', itemName: 'P', purpose: 'in_process', decision: 'APPROVED', decidedAt: null, decidedBy: 'QC ONE', specNumber: null, specVersion: null, requestId: 'TA260001/2.1.3.1', ...o });
const want = (round: number) => ({ kind: 'BATCH' as const, batchNo: 'TA260001', itemId: 'p', code: 'P', request: `TA260001/2.1.3.${round}` });
const result = (o: Partial<QcResult> = {}): QcResult => ({ resultId: 'r1', coaId: 'c1', coaNumber: 'IPR26001', testName: 'Water by KF', reported: '0.42', unit: '%', limitText: 'NMT 0.5',
  analysisNumber: 'LA26001', outsideLab: null, requestId: 'TA260001/2.1.3.1', individual: null, figure: 'result', ...o });
const field = findBlock({ id: 'lab-test', version: 1 })!.fields[0]!;

describe('the in-process rules (shared/engine/lims.ts)', () => {
  it('round 43: a step takes its own request or an earlier round of the same step, never a later round or another step', () => {
    expect(requestFits('TA260001/2.1.3.1', 'TA260001/2.1.3.1')).toBe(true);
    expect(requestFits('ta260001/2.1.3.1', 'TA260001/2.1.3.5')).toBe(true);
    expect(requestFits('TA260001/2.1.3.6', 'TA260001/2.1.3.5')).toBe(false);
    expect(requestFits('TA260001/2.1.4.1', 'TA260001/2.1.3.5')).toBe(false);
    expect(requestFits('TA260001/2.2.3.1', 'TA260001/2.1.3.5')).toBe(false);
    expect(requestFits('TA260002/2.1.3.1', 'TA260001/2.1.3.5')).toBe(false);
    expect(requestFits(null, 'TA260001/2.1.3.1')).toBe(false);
  });

  it('TA-14 an approved in-process report of this request (or an earlier round) may be used; others are refused with the reason', () => {
    expect(coaRefusal(coa(), want(1))).toBeNull();
    expect(coaRefusal(coa(), want(3))).toBeNull();
    expect(coaRefusal(coa({ requestId: 'TA260001/2.1.3.4' }), want(3))).toBe('In-process report IPR26001 is for request TA260001/2.1.3.4, not request TA260001/2.1.3.3 (this step) or an earlier round of it.');
    expect(coaRefusal(coa({ purpose: 'release', coaNumber: 'COA26001' }), want(1))).toBe('CoA COA26001 is of a release sample: only an in-process report of request TA260001/2.1.3.1 (this step) may be used.');
    expect(coaRefusal(coa({ decision: 'REJECTED', coaNumber: null }), want(1))).toMatch(/not approved in LIMS/);
    expect(coaRefusal(coa({ lotNumber: 'TA260002' }), want(1))).toBe('CoA IPR26001 is for batch TA260002, not batch TA260001.');
    // An in-process report is never a batch's release CoA.
    expect(coaRefusal(coa(), { kind: 'BATCH', batchNo: 'TA260001', itemId: 'p', code: 'P' })).toBe('CoA IPR26001 is of an in-process sample: only the release CoA of batch TA260001 may be used.');
  });

  it('TA-14 a single in-process result gives LIMS\'s reported figure, in the field\'s unit (a pH without a unit is a pH)', () => {
    expect(inProcessFit(result(), field, '%')).toEqual({ take: { result: '0.42' } });
    expect(inProcessFit(result({ unit: 'ppm' }), field, '%')).toEqual({ error: 'Water by KF of in-process report IPR26001 is in ppm, not in %.' });
    expect(inProcessFit(result({ individual: ['1', '2'] }), field, '%')).toEqual({ error: 'Water by KF of in-process report IPR26001 is a list of 2 values: Result takes one result.' });
    expect(inProcessFit(result({ figure: 'mean' }), field, '%')).toEqual({ error: 'Water by KF of in-process report IPR26001 reports the mean, not one result: it is not Result.' });
    expect(inProcessFit(result({ reported: null }), field, '%')).toEqual({ error: 'Water by KF of in-process report IPR26001 has no reported figure in LIMS.' });
    expect(sameUnit(null, 'pH')).toBe(true);
    expect(sameUnit('mL', 'ml')).toBe(true);
    expect(sameUnit('mg', '%')).toBe(false);
  });

  it('the record says which round\'s sample was used and when its request opened', () => {
    expect(inProcessText(result(), 'TA260001/2.1.3.1', { round: 1, at: '2026-11-19T05:10:00.000Z' }))
      .toBe('LIMS in-process report IPR26001: Water by KF (request TA260001/2.1.3.1, sampled in round 1 at 2026-11-19T05:10:00.000Z), 0.42 % as reported (limit NMT 0.5), analysis LA26001');
    expect(inProcessText(result(), 'TA260001/2.1.3.1', { at: '2026-11-19T05:10:00.000Z' })).toContain('(request TA260001/2.1.3.1, requested 2026-11-19T05:10:00.000Z)');
  });

  it('only a single number is an in-process result; the reaction\'s IPC result and the QC lab test are marked', () => {
    const b = findBlock({ id: 'lab-test', version: 1 })!;
    expect(blockProblems(b)).toEqual([]);
    const bad: Block = { ...b, fields: [{ ...b.fields[0]!, count: 3 }] };
    expect(blockProblems(bad)).toEqual(['field result: only a single number is an in-process result from LIMS']);
    expect(findBlock({ id: 'react', version: 1 })!.fields.filter((f) => f.qc).map((f) => f.name)).toEqual(['ipcResult']);
    expect(findBlock({ id: 'check', version: 1 })!.fields.filter((f) => f.qc)).toEqual([]);
  });

  it('round 43: a reaction opens a lab request only when the master set its IPC unit (none for a visual or TLC end point)', () => {
    const d = api();
    const si = d.stages.findIndex((s) => s.key === 'step1');
    const ti = d.stages[si]!.steps.findIndex((t) => t.key === 'react');
    expect(labRequestOf(d, { stage: si, sub: 1, step: ti, round: 2 })).toEqual({ stage: 'Step 1: condensation', step: expect.stringMatching(/\(round 2\)$/),
      tests: [{ code: 'react.ipcResult@1', name: 'ipcResult', label: 'IPC result', unit: '%', individual: null }] });
    delete d.stages[si]!.steps[ti]!.settings.ipcUnit;
    expect(labRequestOf(d, { stage: si, sub: 1, step: ti, round: 2 })).toBeNull();
    const react = findBlock({ id: 'react', version: 1 })!;
    expect(labTests(react.fields, () => '', {})).toEqual([]);
  });
});

let t: TestApp;
let provider: Sql;
let L = '';
const cookies: Record<string, string> = {};

beforeAll(async () => {
  t = await freshApp(async (db) => {
    L = `${db.schema}_lims`;
    // LIMS's published views, as tables with the same columns (LIMS appends request_id, individual_values and figure).
    await db.owner.unsafe(`
      create schema ${L};
      create table ${L}.coa_v1 (coa_id uuid, coa_number text, sample_number text, lot_number text, item_kind text, item_master_id text, item_code text,
        item_name text, purpose text, decision text, decided_at timestamptz, decided_by text, spec_number text, spec_version int, reason text,
        read_at timestamptz default now(), data_as_of timestamptz default now(), request_id text);
      create table ${L}.result_v1 (result_id uuid, coa_id uuid, coa_number text, sample_number text, lot_number text, item_master_id text, item_code text,
        test_key text, test_name text, value numeric, unit text, shown text, limit_text text, passed boolean, method_code text, analysis_number text,
        decision text, decided_at timestamptz, read_at timestamptz default now(), data_as_of timestamptz default now(), reported text, outside_lab text,
        request_id text, individual_values numeric[], figure text, ipc_field text, ipc_code text);
      grant usage on schema ${L} to truebatch_api_app;
      grant select on all tables in schema ${L} to truebatch_api_app;`);
    provider = connect(TEST_DATABASE_URL, { role: 'truebatch_api_app', link: true });
    return links({ lims: provider }, { lims: L });
  });
  const item = (itemId: string, code: string, name: string) => ({ itemId, code, name, version: 1, active: true });
  t.master.materials_.push({ ...item('p', 'P', 'P'), category: 'API', unit: 'kg' });
  t.master.materials_.push({ ...item('m', 'M', 'M'), category: null, unit: 'kg' });
  const people = { author: ['truebatch_api.master.author'], issuer: ['truebatch_api.batch.issue'], asha: ['truebatch_api.batch.operate', 'truebatch_api.batch.check'] } as const;
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
/** A batch of one QC lab test of water by KF (NMT 0.5 %); `rounds`: it repeats until the result passes. */
async function issue(rounds = false) {
  const test = { block: { id: 'lab-test', version: 1 }, checker: false, settings: { what: 'Water by KF', unit: '%', limit: { high: '0.5', unit: '%' } },
    ...(rounds ? { flow: { kind: 'repeat-until', maxRounds: 5, stop: 'resultCheck' } } : {}) };
  const yieldStep = { block: { id: 'stage-yield', version: 1 }, checker: true, settings: { theoretical: '0.100 kg', yieldLimit: { low: '97.0', high: '100.5', unit: '%' } } };
  const res = await as('author', 'POST', '/api/masters', { doc: small([{ steps: [test, yieldStep] }]) });
  expect(res.statusCode, res.body).toBe(200);
  const { id } = res.json() as { id: number };
  for (const s of ['in_review', 'approved', 'effective']) await t.owner`update master_versions set state = ${s} where id = ${id}`;
  const b = await as('issuer', 'POST', '/api/batches', { masterVersionId: id, proof: proofFor('issuer') });
  expect(b.statusCode, b.body).toBe(200);
  return b.json() as { id: number; batchNo: string };
}
type StepJson = { id: string; contentHash: string; values: Record<string, unknown>; source: Record<string, { from: string; shown?: string; request?: string; ref?: string; state?: string }> };
const stepOf = async (id: number, key: string) => ((await as('asha', 'GET', `/api/batches/${id}`)).json() as { steps: StepJson[] }).steps.find((s) => s.id === key)!;
const act = (id: number, key: string, action: string, body: object = {}) => as('asha', 'POST', `/api/batches/${id}/steps/${key}/${action}`, body);
const record = (id: number, key: string, values: object) => act(id, key, 'record', { values });
const done = async (id: number, key: string) => act(id, key, 'done', { proof: proofFor('asha'), contentHash: (await stepOf(id, key)).contentHash });
const problems = async (p: ReturnType<typeof record>) => ((await p).json() as { problems: string[] }).problems;
const requests = async (batchNo: string) => (await t.owner.unsafe(`select request_id, product_code, step_title, tests, status from ${t.schema}_report.lab_request_v1 where batch_no = $1 order by request_id`, [batchNo]))
  .map((r) => ({ ...r }));
type Picks = { link: string; request: string; results: { resultId: string; coaNumber: string; reported: string; requestId: string; shown: string }[] };
const picks = async (id: number, key: string) => (await as('asha', 'GET', `/api/batches/${id}/lims?request=${key}&units=${encodeURIComponent(encodeURIComponent('%'))}`)).json() as Picks;
let n = 0;
/** An approved in-process report of `request` in LIMS with one result (reported, unit). */
async function reported(batchNo: string, request: string, figure: string, unit = '%', o: { purpose?: string; decision?: string; ipcField?: string; ipcCode?: string } = {}) {
  n += 1;
  const number = `IPR26${String(n).padStart(3, '0')}`;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const decision = o.decision ?? 'APPROVED';
  await t.owner.unsafe(`insert into ${L}.coa_v1 (coa_id, coa_number, sample_number, lot_number, item_kind, item_master_id, item_code, item_name, purpose, decision, decided_at, decided_by, request_id)
    values ($1, $2, $3, $4, 'MATERIAL', 'p', 'P', 'P', $5, $6, now(), 'QC ONE', $7)`, [id, decision === 'APPROVED' ? number : null, `LS26${n}`, batchNo, o.purpose ?? 'in_process', decision, request]);
  await t.owner.unsafe(`insert into ${L}.result_v1 (result_id, coa_id, coa_number, lot_number, test_key, test_name, unit, limit_text, analysis_number, decision, decided_at, reported, request_id, figure, ipc_field, ipc_code)
    values ($1, $2, $3, $4, 'kf', 'Water by KF', $5, 'NMT 0.5', 'LA26001', $6, now(), $7, $8, 'result', $9, $10)`,
  [`00000000-0000-0000-1111-${String(n).padStart(12, '0')}`, id, decision === 'APPROVED' ? number : null, batchNo, unit, decision, figure, request, o.ipcField ?? null, o.ipcCode ?? null]);
  return number;
}

describe('a QC lab in-process test picked from LIMS', () => {
  let b: { id: number; batchNo: string };
  beforeAll(async () => {
    b = await issue();
    expect((await act(b.id, '0.1.0.1', 'start')).statusCode).toBe(200);
  });

  it('TA-14 the step opens its lab request as it starts (lab_request_v1, open), with its test in the step\'s unit', async () => {
    expect(await requests(b.batchNo)).toEqual([{ request_id: `${b.batchNo}/0.1.0.1`, product_code: 'P', step_title: 'QC lab in-process test: Water by KF',
      tests: [{ code: 'lab-test.result', name: 'result', label: 'Water by KF', unit: '%', individual: null }], status: 'open' }]);
  });

  it('TA-14 while LIMS answers the result is picked (its reported figure, kept with the report and request); typing is refused', async () => {
    expect(await problems(record(b.id, '0.1.0.1', { result: '0.40' }))).toEqual([`Result comes from LIMS: pick the result of in-process request ${b.batchNo}/0.1.0.1 once QC has approved it there.`]);
    const wrong = await reported(b.batchNo, `${b.batchNo}/0.1.0.1`, '0.30', 'ppm');
    const release = await reported(b.batchNo, `${b.batchNo}/0.1.0.1`, '0.30', '%', { purpose: 'release' });
    const good = await reported(b.batchNo, `${b.batchNo}/0.1.0.1`, '0.42');
    expect((await picks(b.id, '0.1.0.1')).results.map((r) => r.coaNumber)).toEqual([good]);
    expect([wrong, release]).toHaveLength(2);
    const [r] = (await picks(b.id, '0.1.0.1')).results;
    expect((await record(b.id, '0.1.0.1', { result: { lims: r!.resultId } })).statusCode).toBe(200);
    const s = await stepOf(b.id, '0.1.0.1');
    expect(s.values.result).toEqual({ value: '0.42', unit: '%' });
    expect(s.source.result).toMatchObject({ from: 'lims', request: `${b.batchNo}/0.1.0.1`, ref: r!.resultId,
      shown: expect.stringMatching(new RegExp(`^LIMS in-process report ${good}: Water by KF \\(request ${b.batchNo}/0\\.1\\.0\\.1, requested .+\\), 0\\.42 % as reported`)) });
    expect(await requests(b.batchNo)).toMatchObject([{ status: 'done' }]);
  });

  it('TA-14 LIMS down: the result is typed from the QC report, marked typed by hand; a pick is refused', async () => {
    const c = await issue();
    await act(c.id, '0.1.0.1', 'start');
    await cut();
    try {
      expect(await problems(record(c.id, '0.1.0.1', { result: { lims: 'x' } }))).toEqual(['LIMS does not answer now: type Result from the QC report.']);
      expect((await record(c.id, '0.1.0.1', { result: '0.41' })).statusCode).toBe(200);
    } finally { await restore(); }
    expect((await stepOf(c.id, '0.1.0.1')).source.result).toEqual({ from: 'hand', link: 'lims', state: 'down' });
    // Its result was typed from the QC report: the request is done.
    expect(await requests(c.batchNo)).toMatchObject([{ status: 'done' }]);
  });
});

describe('round 43: a step with rounds takes an earlier round\'s sample; each result fills one round', () => {
  let b: { id: number; batchNo: string };
  let first = '';
  beforeAll(async () => {
    b = await issue(true);
    // Round 1 is sampled; its result is not back yet, so round 1 is signed with a typed-by-hand result over the limit while
    // LIMS is down (the rounds go on).
    await act(b.id, '0.1.0.1', 'start');
    await cut();
    try { expect((await record(b.id, '0.1.0.1', { result: '0.90' })).statusCode).toBe(200); } finally { await restore(); }
    expect((await done(b.id, '0.1.0.1')).statusCode).toBe(200);
    expect((await act(b.id, '0.1.0.2', 'start')).statusCode).toBe(200);
    first = await reported(b.batchNo, `${b.batchNo}/0.1.0.1`, '0.80');
  });

  it('round 2 is offered round 1\'s sample and picks it; the record says it was sampled in round 1', async () => {
    const p = await picks(b.id, '0.1.0.2');
    expect(p.request).toBe(`${b.batchNo}/0.1.0.2`);
    expect(p.results.map((r) => [r.coaNumber, r.requestId])).toEqual([[first, `${b.batchNo}/0.1.0.1`]]);
    expect((await record(b.id, '0.1.0.2', { result: { lims: p.results[0]!.resultId } })).statusCode).toBe(200);
    const s = await stepOf(b.id, '0.1.0.2');
    expect(s.values.result).toEqual({ value: '0.80', unit: '%' });
    expect(s.source.result!.shown).toMatch(new RegExp(`\\(request ${b.batchNo}/0\\.1\\.0\\.1, sampled in round 1 at .+\\), 0\\.80 %`));
    expect(await requests(b.batchNo)).toMatchObject([{ request_id: `${b.batchNo}/0.1.0.1`, status: 'done' }, { request_id: `${b.batchNo}/0.1.0.2`, status: 'open' }]);
  });

  it('a later round never takes the same result again, and an earlier round never takes a later round\'s sample', async () => {
    const d2 = await done(b.id, '0.1.0.2');
    expect(d2.statusCode, d2.body).toBe(200);
    expect((await act(b.id, '0.1.0.3', 'start')).statusCode).toBe(200);
    const used = (await stepOf(b.id, '0.1.0.2')).source.result!.ref!;
    expect((await picks(b.id, '0.1.0.3')).results).toEqual([]);
    expect(await problems(record(b.id, '0.1.0.3', { result: { lims: used } }))).toEqual([`Result: in-process report ${first} (request ${b.batchNo}/0.1.0.1) was used in another round of this step: one result fills one round.`]);
    await reported(b.batchNo, `${b.batchNo}/0.1.0.4`, '0.20');
    expect((await picks(b.id, '0.1.0.3')).results).toEqual([]);
  });

  it('the round that ends the rounds closes the requests no round picked (cancelled); the picked ones stay done', async () => {
    const third = await reported(b.batchNo, `${b.batchNo}/0.1.0.3`, '0.30');
    const [r] = (await picks(b.id, '0.1.0.3')).results;
    expect(r!.coaNumber).toBe(third);
    expect((await record(b.id, '0.1.0.3', { result: { lims: r!.resultId } })).statusCode).toBe(200);
    expect(await requests(b.batchNo)).toMatchObject([{ status: 'done' }, { status: 'open' }, { status: 'done' }]);
    expect((await done(b.id, '0.1.0.3')).statusCode).toBe(200);
    expect(await requests(b.batchNo)).toMatchObject([{ status: 'done' }, { request_id: `${b.batchNo}/0.1.0.2`, status: 'cancelled' }, { status: 'done' }]);
  });
});

describe('Tablets round 43: a step started before LIMS in-process requests is typed by hand, not stuck', () => {
  it('in words: "started before LIMS in-process requests"; a link down or absent as before', () => {
    expect(handWhy({ link: 'lims', state: 'no_request' })).toBe('started before LIMS in-process requests');
    expect(handWhy({ link: 'lims', state: 'down' })).toBe('LIMS link down');
    expect(handWhy({ link: 'lims', state: 'down' }, 'link was down')).toBe('LIMS link was down');
    expect(handWhy({ link: 'mms', state: 'absent' })).toBe('MMS not linked');
    expect(qcReportText({ reportNo: 'QC-1', source: { from: 'hand', link: 'lims', state: 'absent' } })).toBe('QC report QC-1 (typed by hand: LIMS not linked)');
  });

  it('TA-14 while LIMS answers: no pick is offered or taken; the result is typed, marked, checked by a second person and listed for QA', async () => {
    const b = await issue();
    // Started as a step was before the port: its "started" event has no lab request.
    await t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id)
      values (${b.id}, 0, 1, 0, 1, 'started', '{}', (select id from users where username = 'asha'))`;
    expect(await requests(b.batchNo)).toEqual([]);
    await reported(b.batchNo, `${b.batchNo}/0.1.0.1`, '0.42');
    const p = await as('asha', 'GET', `/api/batches/${b.id}/lims?request=0.1.0.1&units=${encodeURIComponent(encodeURIComponent('%'))}`);
    expect(p.json()).toEqual({ link: 'ok', request: `${b.batchNo}/0.1.0.1`, noRequest: true, coas: [], results: [] });
    expect(await problems(record(b.id, '0.1.0.1', { result: { lims: 'x' } }))).toEqual(['Result: this step was started before LIMS in-process requests: type it from the QC report.']);
    expect((await record(b.id, '0.1.0.1', { result: '0.42' })).statusCode).toBe(200);
    expect((await stepOf(b.id, '0.1.0.1')).source.result).toEqual({ from: 'hand', link: 'lims', state: 'no_request' });
    const review = (await as('asha', 'GET', `/api/batches/${b.id}/review`)).json() as { hand: { field: string; link: string; state: string }[] };
    expect(review.hand).toContainEqual(expect.objectContaining({ field: 'result', link: 'lims', state: 'no_request' }));
    // A value typed by hand needs a second-person check: signing it alone leaves it awaiting the check.
    expect((await done(b.id, '0.1.0.1')).statusCode).toBe(200);
    expect(((await as('asha', 'GET', `/api/batches/${b.id}`)).json() as { steps: { id: string; state: string }[] }).steps.find((s) => s.id === '0.1.0.1')!.state).toBe('done_awaiting_check');
    const l = (await loadBatch(t.sql, b.id))!;
    expect(JSON.stringify(batchRecordDoc(await recordInput(t.sql, l, t.master), 'ASHA', new Date(), false))).toContain('BY HAND: started before LIMS in-process requests');
  });
});

describe('Tablets round 44: a result that names the field it answers (result_v1.ipc_field) fills only that field', () => {
  const react = findBlock({ id: 'react', version: 1 })!;
  const ipc = react.fields.find((f) => f.name === 'ipcResult')!;
  it('no field named (an older LIMS): matched by its unit; its own field: taken; another field: refused, naming both', () => {
    expect(answersField(result({ ipcField: null }), field)).toBe(true);
    expect(answersField(result({ ipcField: 'result' }), field)).toBe(true);
    expect(answersField(result({ ipcField: 'ipcResult' }), field)).toBe(false);
    expect(fieldRefusal(result({ ipcField: 'ph' }), ipc, react.fields)).toBe('Water by KF of report IPR26001 answers pH, not IPC result.');
    expect(inProcessFit(result({ ipcField: 'ph' }), ipc, '%', react.fields)).toEqual({ error: 'Water by KF of report IPR26001 answers pH, not IPC result.' });
    expect(inProcessFit(result({ ipcField: 'ipcResult' }), ipc, '%', react.fields)).toEqual({ take: { ipcResult: '0.42' } });
  });

  it('TA-14 the step is offered only the results of its own field; another field\'s result is refused when picked', async () => {
    const b = await issue();
    await act(b.id, '0.1.0.1', 'start');
    const own = await reported(b.batchNo, `${b.batchNo}/0.1.0.1`, '0.42', '%', { ipcField: 'result' });
    await reported(b.batchNo, `${b.batchNo}/0.1.0.1`, '0.10', '%', { ipcField: 'other' });
    const p = await picks(b.id, '0.1.0.1');
    expect(p.results.map((r) => [r.coaNumber, (r as { ipcField?: string }).ipcField])).toEqual([[own, 'result'], [expect.any(String), 'other']]);
    const other = p.results.find((r) => r.coaNumber !== own)!;
    expect(await problems(record(b.id, '0.1.0.1', { result: { lims: other.resultId } }))).toEqual([`Water by KF of report ${other.coaNumber} answers other, not Result.`]);
    expect((await record(b.id, '0.1.0.1', { result: { lims: p.results.find((r) => r.coaNumber === own)!.resultId } })).statusCode).toBe(200);
    expect((await stepOf(b.id, '0.1.0.1')).values.result).toEqual({ value: '0.42', unit: '%' });
  });
});

describe('Tablets round 45: in-process test codes unique within the product (lab_request_v1 tests[].code, result_v1.ipc_code)', () => {
  const react = findBlock({ id: 'react', version: 1 })!;
  const ipc = react.fields.find((f) => f.name === 'ipcResult')!;
  it('a block used once has <block id>.<field name>; a block in the master more than once gets @<n> by its order', () => {
    const d = api();
    expect(ipcCodes(d, 1, 3, react.fields)).toEqual({ ipcResult: 'react.ipcResult@1' });
    expect(ipcCodes(d, 2, 0, react.fields)).toEqual({ ipcResult: 'react.ipcResult@2' });
    const one = small([{ steps: [{ block: { id: 'lab-test', version: 1 }, checker: false, settings: {} }] }]);
    expect(ipcCodes(one, 0, 0, [field])).toEqual({ result: 'lab-test.result' });
    expect(labTests([field], () => '%', { result: 'lab-test.result' })).toEqual([{ code: 'lab-test.result', name: 'result', label: 'Result', unit: '%', individual: null }]);
  });

  it('the master check says a repeated in-process block must be mapped in LIMS for each occurrence (info, never blocking)', () => {
    const d = api();
    expect(masterChecks(d).filter((p) => p.level === 'info').map((p) => [p.path, p.message])).toEqual([
      ['stages[1].steps[3]', "Process to an end point is in this master 2 times: this step's in-process test is react.ipcResult@1. LIMS specification must map each occurrence"],
      ['stages[2].steps[0]', "Process to an end point is in this master 2 times: this step's in-process test is react.ipcResult@2. LIMS specification must map each occurrence"],
    ]);
    // A reaction without an IPC unit (TLC or visual end point) opens no request: nothing to map.
    delete d.stages[2]!.steps[0]!.settings.ipcUnit;
    expect(masterChecks(d).filter((p) => p.level === 'info').map((p) => p.path)).toEqual(['stages[1].steps[3]']);
  });

  it('a result naming a code fills only the field of that code (before ipc_field); none named: the round 44 rule', () => {
    const codes = { ipcResult: 'react.ipcResult@2' };
    expect(answersField(result({ ipcCode: 'react.ipcResult@2', ipcField: 'ph' }), ipc, codes)).toBe(true);
    expect(answersField(result({ ipcCode: 'react.ipcResult@1' }), ipc, codes)).toBe(false);
    expect(answersField(result({ ipcCode: null, ipcField: 'ipcResult' }), ipc, codes)).toBe(true);
    expect(inProcessFit(result({ ipcCode: 'react.ipcResult@1' }), ipc, '%', react.fields, codes))
      .toEqual({ error: 'Water by KF of report IPR26001 answers in-process test react.ipcResult@1, not IPC result.' });
    expect(inProcessFit(result({ ipcCode: 'react.ipcResult@2' }), ipc, '%', react.fields, codes)).toEqual({ take: { ipcResult: '0.42' } });
  });

  it('TA-14 the lab request lists each test with its code; a result of another code is refused, its own code taken', async () => {
    const b = await issue();
    await act(b.id, '0.1.0.1', 'start');
    expect((await requests(b.batchNo))[0]!.tests).toEqual([{ code: 'lab-test.result', name: 'result', label: 'Water by KF', unit: '%', individual: null }]);
    await reported(b.batchNo, `${b.batchNo}/0.1.0.1`, '0.10', '%', { ipcCode: 'react.ipcResult@1' });
    const own = await reported(b.batchNo, `${b.batchNo}/0.1.0.1`, '0.42', '%', { ipcCode: 'lab-test.result', ipcField: 'other' });
    const p = await picks(b.id, '0.1.0.1');
    expect(p.results.map((r) => (r as { ipcCode?: string }).ipcCode)).toEqual(['react.ipcResult@1', 'lab-test.result']);
    const other = p.results.find((r) => r.coaNumber !== own)!;
    expect(await problems(record(b.id, '0.1.0.1', { result: { lims: other.resultId } }))).toEqual([`Water by KF of report ${other.coaNumber} answers in-process test react.ipcResult@1, not Result.`]);
    expect((await record(b.id, '0.1.0.1', { result: { lims: p.results.find((r) => r.coaNumber === own)!.resultId } })).statusCode).toBe(200);
    expect((await stepOf(b.id, '0.1.0.1')).values.result).toEqual({ value: '0.42', unit: '%' });
  });
});

describe('A2 more than one in-process lab test in one step (fix round 21 Nov 2026)', () => {
  const b = findBlock({ id: 'lab-tests', version: 1 })!;
  it('each test set by the master is one test of the lab request, named as the master names it; an unset one is left out', () => {
    const settings = { what1: 'Assay of the intermediate', unit1: '%', what2: 'Water by KF', unit2: '%' };
    const fields = labelled(b.fields, settings);
    const codes = ipcCodes({ stages: [{ steps: [{ block: { id: 'lab-tests' } }] }] }, 0, 0, b.fields);
    const unitOf = (f: BlockField) => { const u = f.unit?.startsWith('$') ? (settings as Record<string, string>)[f.unit.slice(1)] : f.unit; return u ?? ''; };
    expect(labTests(fields, unitOf, codes)).toEqual([
      { code: 'lab-tests.test1', name: 'test1', label: 'Assay of the intermediate', unit: '%', individual: null },
      { code: 'lab-tests.test2', name: 'test2', label: 'Water by KF', unit: '%', individual: null },
    ]);
    expect(blockProblems(b)).toEqual([]);
    // A result naming test 2's code fills test 2 only.
    const r = { testName: 'Water', coaNumber: 'IPR1', unit: '%', reported: '0.31', individual: null, figure: 'result', ipcField: null, ipcCode: 'lab-tests.test2' };
    expect(inProcessFit(r, b.fields[1]!, '%', b.fields, codes)).toEqual({ take: { test2: '0.31' } });
    expect(inProcessFit(r, b.fields[0]!, '%', b.fields, codes)).toMatchObject({ error: expect.stringContaining('answers Lab test 2, not Lab test 1') });
  });
  it('a lab test 2 or 3 is set in full or not at all (master check)', () => {
    const d = small([{ steps: [{ block: { id: 'lab-tests', version: 1 }, checker: true, settings: { what1: 'Assay', unit1: '%', limit1: { low: '98.0', high: '102.0', unit: '%' }, what2: 'Water by KF' } }] }]);
    expect(masterChecks(d).filter((p) => p.level === 'error').map((p) => p.message)).toContain('Lab test 2: set what is tested, its unit and its limits, or none of them');
  });
});
