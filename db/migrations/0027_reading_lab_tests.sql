-- Fix round 21 Nov 2026 (A2): the new block's number fields in reading_parameters (in-process lab tests), as
-- shared/engine/readings.ts lists them (test/readings.test.ts compares the two). reading_v1 is replaced in place with
-- the same columns (0024): a lab test's parameter is what the master says it tests (its "what" setting), as for a
-- "check a value" or "QC lab in-process test" step. Nothing new is stored.

-- In the product's own schema (created before the report schema is put first in search_path): not published.
create or replace view reading_parameters (block, field, label, limit_setting, fixed_limit, limit_of) as values
  ('weigh', 'assay', 'Assay (certificate)', null, null::jsonb, null),
  ('weigh', 'water', 'Water content (certificate)', null, null::jsonb, null),
  ('weigh', 'lod', 'Loss on drying (certificate)', null, null::jsonb, null),
  ('weigh', 'content', 'Content (certificate)', null, null::jsonb, null),
  ('weigh', 'gross', 'Gross weight', null, null::jsonb, null),
  ('weigh', 'tare', 'Tare weight', null, null::jsonb, null),
  ('charge-liquid', 'charged', 'Quantity charged', null, null::jsonb, null),
  ('charge-liquid', 'maxTemperature', 'Highest temperature during the addition', 'temperatureLimit', null::jsonb, 'each'),
  ('mix', 'speed', 'Speed', 'speedLimit', null::jsonb, 'each'),
  ('react', 'temperature', 'Temperature', 'temperatureLimit', null::jsonb, 'each'),
  ('react', 'pressure', 'Pressure (bar, gauge or absolute as the master says)', 'pressureLimit', null::jsonb, 'each'),
  ('react', 'ph', 'pH', 'phLimit', null::jsonb, 'each'),
  ('react', 'ipcResult', 'IPC result', 'ipcLimit', null::jsonb, 'each'),
  ('separate', 'toRecovery', 'Quantity sent to solvent recovery', null, null::jsonb, null),
  ('separate', 'recoveryContainers', 'Containers sent to solvent recovery', null, null::jsonb, null),
  ('distil', 'temperature', 'Pot temperature', 'temperatureLimit', null::jsonb, 'each'),
  ('distil', 'vacuum', 'Vacuum', 'vacuumLimit', null::jsonb, 'each'),
  ('distil', 'volumeLeft', 'Volume left in the vessel', 'volumeLimit', null::jsonb, 'each'),
  ('distil', 'toRecovery', 'Distillate sent to solvent recovery', null, null::jsonb, null),
  ('distil', 'recoveryContainers', 'Containers sent to solvent recovery', null, null::jsonb, null),
  ('distil-dry', 'temperature', 'Pot temperature', 'temperatureLimit', null::jsonb, 'each'),
  ('distil-dry', 'vacuum', 'Vacuum', 'vacuumLimit', null::jsonb, 'each'),
  ('distil-dry', 'toRecovery', 'Distillate sent to solvent recovery', null, null::jsonb, null),
  ('distil-dry', 'recoveryContainers', 'Containers sent to solvent recovery', null, null::jsonb, null),
  ('column', 'volume', 'Portion volume', null, null::jsonb, null),
  ('column', 'result', 'Portion test result', 'resultLimit', null::jsonb, 'each'),
  ('isolate', 'wash', 'Wash quantity', null, null::jsonb, null),
  ('isolate', 'gross', 'Wet cake gross weight', null, null::jsonb, null),
  ('isolate', 'tare', 'Container tare weight', null, null::jsonb, null),
  ('isolate', 'toRecovery', 'Mother liquor sent to solvent recovery', null, null::jsonb, null),
  ('isolate', 'recoveryContainers', 'Containers sent to solvent recovery', null, null::jsonb, null),
  ('dry', 'inletTemp', 'Inlet temperature', null, null::jsonb, null),
  ('dry', 'lod', 'Loss on drying', 'lodLimit', null::jsonb, 'each'),
  ('dry-constant', 'weight', 'Sample weight', null, null::jsonb, null),
  ('sieve-analysis', 'sample', 'Sample weight', null, null::jsonb, null),
  ('sieve-analysis', 'retained1', 'Retained on sieve 1', null, null::jsonb, null),
  ('sieve-analysis', 'retained2', 'Retained on sieve 2', null, null::jsonb, null),
  ('sieve-analysis', 'retained3', 'Retained on sieve 3', null, null::jsonb, null),
  ('sieve-analysis', 'retained4', 'Retained on sieve 4', null, null::jsonb, null),
  ('sieve-analysis', 'retained5', 'Retained on sieve 5', null, null::jsonb, null),
  ('sieve-analysis', 'pan', 'In the pan', null, null::jsonb, null),
  ('sub-batch-combine', 'sub1', 'Sub-batch 1', null, null::jsonb, null),
  ('sub-batch-combine', 'sub2', 'Sub-batch 2', null, null::jsonb, null),
  ('sub-batch-combine', 'sub3', 'Sub-batch 3', null, null::jsonb, null),
  ('sub-batch-combine', 'sub4', 'Sub-batch 4', null, null::jsonb, null),
  ('sub-batch-combine', 'sub5', 'Sub-batch 5', null, null::jsonb, null),
  ('sub-batch-combine', 'sub6', 'Sub-batch 6', null, null::jsonb, null),
  ('sub-batch-combine', 'sub7', 'Sub-batch 7', null, null::jsonb, null),
  ('sub-batch-combine', 'sub8', 'Sub-batch 8', null, null::jsonb, null),
  ('sub-batch-combine', 'sub9', 'Sub-batch 9', null, null::jsonb, null),
  ('sub-batch-combine', 'sub10', 'Sub-batch 10', null, null::jsonb, null),
  ('sub-batch-combine', 'output', 'Combined weight', null, null::jsonb, null),
  ('check', 'reading', 'Reading', 'limit', null::jsonb, 'each'),
  ('lab-test', 'result', 'Result', 'limit', null::jsonb, 'each'),
  ('lab-tests', 'test1', 'Lab test 1', 'limit1', null::jsonb, 'each'),
  ('lab-tests', 'test2', 'Lab test 2', 'limit2', null::jsonb, 'each'),
  ('lab-tests', 'test3', 'Lab test 3', 'limit3', null::jsonb, 'each'),
  ('qa-sample', 'taken', 'Quantity taken', 'sampleLimit', null::jsonb, 'each'),
  ('stage-yield', 'output', 'Output', null, null::jsonb, null),
  ('stage-yield', 'samples', 'Samples', null, null::jsonb, null),
  ('stage-yield', 'rejects', 'Rejects', null, null::jsonb, null),
  ('container-issue', 'issued', 'Count issued', null, null::jsonb, null),
  ('pack-material-issue', 'issued', 'Quantity issued', null, null::jsonb, null),
  ('container-fill', 'tare', 'Tare (container and liner)', null, null::jsonb, null),
  ('container-fill', 'gross', 'Gross weight', null, null::jsonb, null),
  ('container-fill-last', 'tare', 'Tare (container and liner)', null, null::jsonb, null),
  ('container-fill-last', 'gross', 'Gross weight', null, null::jsonb, null),
  ('container-return', 'returned', 'Count returned to stores', null, null::jsonb, null),
  ('printed-reconciliation', 'used', 'Used in good packs', null, null::jsonb, null),
  ('printed-reconciliation', 'destroyed', 'Destroyed (batch-coded leftovers and rejects)', null, null::jsonb, null),
  ('printed-reconciliation', 'returned', 'Returned to stores uncoded, after a documented check', null, null::jsonb, null)
;

do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view reading_v1 with (security_barrier) as
select b.batch_no || '/' || concat_ws('.', c.stage, c.sub, c.step, c.round) || '/' || c.field || '/' || r.n as reading_id,
  b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  v.doc->'stages'->c.stage->>'name' as stage, (v.doc->'stages'->c.stage->>'key') || '/' || (st.step->>'key') as step,
  coalesce(d.place, (v.doc->'stages'->c.stage->>'name') || ' › ' || (st.step->>'key')) as step_name, c.sub as sub_batch, c.round,
  p.block, case when p.block in ('check', 'lab-test') and st.step->'settings'->>'what' <> '' then st.step->'settings'->>'what'
    when p.block = 'lab-tests' and st.step->'settings'->>('what' || substr(p.field, 5)) <> '' then st.step->'settings'->>('what' || substr(p.field, 5)) else p.label end as parameter,
  p.field, r.n::int as reading_no, (r.x->>'value')::numeric as value, r.x->>'unit' as unit,
  case when coalesce(lim.l, p.fixed_limit)->>'low' ~ '^-?[0-9]+(\.[0-9]+)?$' then (coalesce(lim.l, p.fixed_limit)->>'low')::numeric end as low_limit,
  case when coalesce(lim.l, p.fixed_limit)->>'high' ~ '^-?[0-9]+(\.[0-9]+)?$' then (coalesce(lim.l, p.fixed_limit)->>'high')::numeric end as high_limit,
  coalesce(lim.l, p.fixed_limit)->>'unit' as limit_unit, case when coalesce(lim.l, p.fixed_limit) is null then null else p.limit_of end as limit_of,
  c.at as recorded_at, c.kind = 'corrected' as corrected, now() as read_at, c.at as data_as_of
from (
  -- The current value of each field of each round of a step: the last value or correction that recorded it.
  select distinct on (x.batch_id, x.stage, x.sub, x.step, x.round, f.key) x.batch_id, x.stage, x.sub, x.step, x.round, f.key as field, f.value, x.kind, x.at
  from step_events x cross join jsonb_each(x.payload->'values') f
  where x.kind in ('value', 'corrected') and jsonb_typeof(x.payload->'values') = 'object'
  order by x.batch_id, x.stage, x.sub, x.step, x.round, f.key, x.id desc
) c
join batches b on b.id = c.batch_id
join master_versions v on v.id = b.master_version_id
cross join lateral (select v.doc->'stages'->c.stage->'steps'->c.step as step) st
join reading_parameters p on p.block = st.step->'block'->>'id' and p.field = c.field
-- Signed done (this round), with the step's place in words as kept with its start.
cross join lateral (
  select bool_or(e.kind = 'done') as done, (array_agg(e.payload->>'where' order by e.id) filter (where e.kind = 'started'))[1] as place
  from step_events e where e.batch_id = c.batch_id and e.stage = c.stage and e.sub = c.sub and e.step = c.step and e.round = c.round
) d
-- One reading, or each reading of a list in order.
cross join lateral (
  select c.value as x, 1::bigint as n where jsonb_typeof(c.value) = 'object'
  union all
  select a.x, a.n from jsonb_array_elements(case when jsonb_typeof(c.value) = 'array' then c.value else '[]' end) with ordinality a(x, n)
) r
-- The master step's limit, when it is a written one (low and/or high with a unit; not an earlier step's result).
left join lateral (
  select st.step->'settings'->p.limit_setting as l
  where p.limit_setting is not null and jsonb_typeof(st.step->'settings'->p.limit_setting) = 'object' and st.step->'settings'->p.limit_setting ? 'unit'
) lim on true
where d.done and jsonb_typeof(r.x) = 'object' and r.x->>'value' ~ '^-?[0-9]+(\.[0-9]+)?$';

revoke all on reading_v1 from public;
comment on view reading_v1 is 'One row per recorded number of a step signed done (process parameters and in-process checks), with the master''s limits; for continued process verification (Operations).';
comment on column reading_v1.limit_of is 'each: the limit applies to each reading; mean: to the mean of the list (T7). Null without a limit.';

reset search_path;
