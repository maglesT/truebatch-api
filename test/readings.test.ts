// Tablets round 46: report.reading_v1, one row per recorded number of a step signed done, with the master's limits, for
// Operations' continued process verification (db/migrations/0024, shared/engine/readings.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readingParameters } from '../shared/engine/readings.js';
import { BLOCKS } from '../shared/blocks/index.js';
import { freshDb, seedUser, type TestDb } from './helpers.js';
import { small } from './engine-fixture.js';

let t: TestDb;
let user = 0;
beforeAll(async () => {
  t = await freshDb();
  user = await seedUser(t.owner, 'reader.one', []);
});
afterAll(async () => t?.close());
const rep = () => `${t.schema}_report`;

const q = (value: string, unit: string) => ({ value, unit });
async function batch(no: string, steps: object[]) {
  const doc = small([{ key: 'reaction', name: 'Reaction', steps }]);
  const [v] = await t.owner<{ id: number }[]>`insert into master_versions (version_no, doc, created_by) values (1, ${t.owner.json(doc as never)}, ${user}) returning id::int`;
  const [b] = await t.owner<{ id: number }[]>`insert into batches (batch_no, master_version_id, issued_by) values (${no}, ${v!.id}, ${user}) returning id::int`;
  return (step: number, round: number, kind: string, payload: object, at: string) => t.owner`insert into step_events (batch_id, stage, sub, step, round, kind, payload, person_id, at)
    values (${b!.id}, 0, 1, ${step}, ${round}, ${kind}, ${t.owner.json(payload as never)}, ${user}, ${at})`;
}
const rows = (no: string) => t.owner.unsafe(`select reading_id, stage, step, step_name, sub_batch, round, block, parameter, field, reading_no, value::text, unit,
  low_limit::text, high_limit::text, limit_unit, limit_of, recorded_at, corrected from ${rep()}.reading_v1 where batch_number = $1 order by step, round, field, reading_no`, [no]);

describe('reading_v1', () => {
  it('the list of number fields in the database is the blocks\' (a new number field needs a migration replacing reading_parameters)', async () => {
    const db = await t.owner<{ block: string; field: string; label: string; limit_setting: string | null; fixed_limit: object | null; limit_of: string | null }[]>`
      select block, field, label, limit_setting, fixed_limit, limit_of from reading_parameters`;
    expect(db.map((r) => ({ block: r.block, field: r.field, label: r.label, limitSetting: r.limit_setting, fixedLimit: r.fixed_limit, limitOf: r.limit_of })))
      .toEqual(readingParameters());
    // The API blocks feed it, with their limits.
    expect(readingParameters().filter((p) => p.block === 'react').map((p) => [p.field, p.limitSetting, p.limitOf])).toEqual([
      ['temperature', 'temperatureLimit', 'each'], ['pressure', 'pressureLimit', 'each'], ['ph', 'phLimit', 'each'], ['ipcResult', 'ipcLimit', 'each']]);
    expect(readingParameters().filter((p) => p.block === 'column').map((p) => [p.field, p.limitSetting, p.limitOf])).toEqual([
      ['volume', null, null], ['result', 'resultLimit', 'each']]);
    // Every block with a number field is listed (one block id per block: the list is keyed by it).
    const withNumbers = BLOCKS.filter((b) => b.fields.some((f) => f.kind === 'number')).map((b) => b.id);
    expect([...new Set(readingParameters().map((p) => p.block))]).toEqual(withNumbers);
    expect(new Set(BLOCKS.map((b) => b.id)).size).toBe(BLOCKS.length);
  });

  it('one row per reading of a step signed done, with the master\'s limits; an optional limit left unset gives none; the current value after a correction', async () => {
    const react = { key: 'react', block: { id: 'react', version: 1 }, settings: { temperatureLimit: { low: '60', high: '65', unit: '°C' }, ipcUnit: '%',
      ipcLimit: { high: '0.5', unit: '%' } } };
    const e = await batch('READ-1', [react, { key: 'check', settings: { what: 'pH of the quench', unit: '', limit: { low: '5.0', high: '7.0', unit: '' } } },
      { key: 'kf', block: { id: 'lab-test', version: 1 }, settings: { what: 'Water by KF', unit: '%', limit: { high: '0.5', unit: '%' } } }]);
    await e(0, 1, 'started', { where: 'Reaction › Process to an end point' }, '2026-11-20 08:00+00');
    await e(0, 1, 'value', { values: { machine: { code: 'R-01' }, temperature: q('62.0', '°C'), pressure: q('1.2', 'bar'), ipcMethod: 'HPLC' } }, '2026-11-20 08:05+00');
    // Round 2 recorded, not signed: not published yet.
    await e(0, 2, 'started', {}, '2026-11-20 08:30+00');
    await e(0, 2, 'value', { values: { temperature: q('63.0', '°C') } }, '2026-11-20 08:31+00');
    // The "check a value" and the in-process lab test steps: their parameter is what the master says they check.
    await e(1, 1, 'started', {}, '2026-11-20 09:00+00');
    await e(1, 1, 'value', { values: { reading: q('6.1', '') } }, '2026-11-20 09:01+00');
    await e(1, 1, 'done', {}, '2026-11-20 09:02+00');
    await e(2, 1, 'started', {}, '2026-11-20 09:10+00');
    await e(2, 1, 'value', { values: { result: q('0.21', '%') } }, '2026-11-20 09:11+00');
    await e(2, 1, 'done', {}, '2026-11-20 09:12+00');
    expect((await rows('READ-1')).map((r) => r.field)).toEqual(['reading', 'result']);
    await e(0, 1, 'done', {}, '2026-11-20 08:06+00');
    const r = await rows('READ-1');
    expect(r.map((x) => [x.field, x.reading_no, x.value, x.unit, x.low_limit, x.high_limit, x.limit_unit, x.limit_of])).toEqual([
      ['reading', 1, '6.1', '', '5.0', '7.0', '', 'each'],
      ['result', 1, '0.21', '%', null, '0.5', '%', 'each'],
      ['pressure', 1, '1.2', 'bar', null, null, null, null],
      ['temperature', 1, '62.0', '°C', '60', '65', '°C', 'each'],
    ]);
    expect(r[3]).toMatchObject({ reading_id: 'READ-1/0.1.0.1/temperature/1', stage: 'Reaction', step: 'reaction/react', step_name: 'Reaction › Process to an end point',
      sub_batch: 1, round: 1, block: 'react', parameter: 'Temperature', recorded_at: new Date('2026-11-20T08:05:00Z'), corrected: false });
    expect(r[0]).toMatchObject({ parameter: 'pH of the quench', step_name: 'Reaction › check' });
    expect(r[1]).toMatchObject({ parameter: 'Water by KF', block: 'lab-test' });
    await e(0, 1, 'corrected', { values: { temperature: q('61.5', '°C') }, reason: 'Misread' }, '2026-11-20 10:00+00');
    expect((await rows('READ-1')).find((x) => x.field === 'temperature')).toMatchObject({ value: '61.5', corrected: true, recorded_at: new Date('2026-11-20T10:00:00Z') });
  });

  it('is published in the report schema with its columns, closed to everybody until the platform links a reader', async () => {
    const cols = await t.owner.unsafe(`select column_name || ' ' || data_type as c from information_schema.columns where table_schema = $1 and table_name = 'reading_v1' order by ordinal_position`, [rep()]);
    expect(cols.map((c) => c.c)).toEqual(['reading_id text', 'batch_number text', 'product_code text', 'stage text', 'step text', 'step_name text', 'sub_batch integer', 'round integer',
      'block text', 'parameter text', 'field text', 'reading_no integer', 'value numeric', 'unit text', 'low_limit numeric', 'high_limit numeric', 'limit_unit text', 'limit_of text',
      'recorded_at timestamp with time zone', 'corrected boolean', 'read_at timestamp with time zone', 'data_as_of timestamp with time zone']);
    await expect(t.sql.unsafe(`select 1 from ${rep()}.reading_v1 limit 1`)).rejects.toThrow(/permission denied/);
  });

  it('PL-01 the report schema holds exactly the views the manifest publishes (reading_v1 among them); reading_parameters is not published', async () => {
    const m = JSON.parse(readFileSync(path.join(import.meta.dirname, '../ops/manifest.draft.json'), 'utf8')) as { publishes: string[] };
    const views = await t.owner.unsafe(`select table_name from information_schema.views where table_schema = $1 order by table_name`, [rep()]);
    expect(views.map((v) => v.table_name)).toEqual([...m.publishes].sort());
    expect(m.publishes).toContain('reading_v1');
  });
});
