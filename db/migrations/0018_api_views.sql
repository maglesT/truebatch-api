-- TrueBatch API's published views (plan section 6, owner 18 Nov 2026), every column name as TrueBatch Tablets':
--   batch_fact_v1:   the output is the packed API: good_quantity = the output of the batch's last stage yield (Pack and
--                    label: the net kg packed), good_unit 'kg', yield_percent its yield; null until that step is done.
--   material_use_v1: besides the weighings, the liquids charged (charge-liquid) and the containers and packing
--                    materials issued less what was counted back once that step is done (container-return,
--                    printed-reconciliation); less what QA said went back when terminating, as before.
--   output_lot_v1:   new: the lots that go to stores. One per batch (the API, or the intermediate of a master that makes
--                    an intermediate for stores): the net kg and number of containers filled, the date of manufacture,
--                    the retest date (TA-27: the end of the month before date of manufacture + retest period; never
--                    later than the date of the API lots in it, TA-25) and whether QA released it (MMS receives it
--                    then, TA-21). And one per solvent sent to recovery (TA-24: separate, distil, isolate), of the
--                    recovered material its formula line names, at once (MMS tests and releases it).
-- create or replace keeps the grants the platform's set_link gave; a new view gets them from set_link.

do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

create or replace view batch_fact_v1 with (security_barrier) as
select md5('truebatch_api:batch:' || b.id)::uuid as batch_id, b.batch_no as batch_number, v.doc->'header'->>'productCode' as product_code,
  null::text as strength, md5('truebatch_api:master_version:' || v.id)::uuid as mbr_version_id, v.version_no::text as family_code,
  'PROCESSING'::text as record_kind,
  case when e.released then 'RELEASED' when e.rejected then 'REJECTED' when e.qc then 'QC_APPROVED'
       when e.produced is not null then 'PRODUCTION_APPROVED' else 'IN_PRODUCTION' end as status,
  b.issued_at, e.produced as completed_at, coalesce(e.released, false) as released,
  now() as read_at, greatest(b.issued_at, s.last, e.last) as data_as_of,
  (s.started at time zone 'Asia/Kolkata')::date as manufactured_on,
  v.doc->'header'->>'productName' as product_name, v.version_no as master_version,
  round(nullif(yv.v->'output'->>'value', '')::numeric, 3) as good_quantity, 'kg'::text as good_unit,
  round(nullif(y.r->'yield'->>'value', '')::numeric, 2) as yield_percent,
  rl.at as released_at, rl.by as released_by
from batches b
join master_versions v on v.id = b.master_version_id
left join lateral (
  select bool_or(x.kind = 'released') as released, bool_or(x.kind = 'rejected') as rejected, bool_or(x.kind = 'qc_approved') as qc,
    min(x.at) filter (where x.kind = 'production_approved') as produced, max(x.at) as last
  from batch_events x where x.batch_id = b.id
) e on true
left join lateral (
  select max(x.at) as last, min(x.at) filter (where x.kind = 'started') as started from step_events x where x.batch_id = b.id
) s on true
left join lateral (
  select x.at, (select g.printed_name from signatures g where g.object_type = 'batch_event' and g.object_id = x.id and g.meaning = 'released') as by
  from batch_events x where x.batch_id = b.id and x.kind = 'released' order by x.id limit 1
) rl on true
-- The batch's last stage yield (Pack and label's): its values and results as last recorded, once done.
left join lateral (
  select (st.i - 1)::int as stage, (sp.j - 1)::int as step
  from jsonb_array_elements(v.doc->'stages') with ordinality st(x, i), jsonb_array_elements(st.x->'steps') with ordinality sp(y, j)
  where sp.y->'block'->>'id' = 'stage-yield' order by st.i desc, sp.j desc limit 1
) tr on true
left join lateral (select (select case when (select z.kind from step_events z where z.batch_id = b.id and z.stage = tr.stage and z.sub = 1 and z.step = tr.step
      and z.round = 1 and z.kind in ('done', 'sent_back') order by z.id desc limit 1) = 'done'
    then (select coalesce(jsonb_object_agg(q.k, q.val), '{}') from (
      select distinct on (x.key) x.key as k, x.value as val from step_events y cross join lateral jsonb_each(y.payload->'values') x
      where y.batch_id = b.id and y.stage = tr.stage and y.sub = 1 and y.step = tr.step and y.round = 1 and y.payload ? 'values'
      order by x.key, y.id desc) q) end) as v) yv on true
left join lateral (
  select jsonb_object_agg(k, val) filter (where (val->>'ok')::boolean) as r from (
    select distinct on (x.key) x.key as k, x.value as val
    from step_events y cross join lateral jsonb_each(y.payload->'results') x
    where y.batch_id = b.id and y.stage = tr.stage and y.step = tr.step and y.sub = 1 and y.payload ? 'results' and yv.v is not null
    order by x.key, y.id desc) q
) y on true;

create or replace view material_use_v1 with (security_barrier) as
select w.batch_number, w.lot_number, w.material_code, w.material_master_id,
  w.quantity - least(w.quantity, greatest(coalesce(w.returned, 0) - coalesce(sum(w.quantity) over (partition by w.batch_id, lower(w.lot_number), w.unit
    order by w.stage desc, w.sub desc, w.step_no desc, w.round desc rows between unbounded preceding and 1 preceding), 0), 0)) as quantity,
  w.unit, w.dispensed_at, w.step, w.event_id, w.status, w.read_at,
  case when w.returned > 0 then greatest(w.data_as_of, w.returned_at) else w.data_as_of end as data_as_of, w.step_name
from (
  select s.batch_id, s.stage, s.sub, s.step as step_no, s.round,
    b.batch_no as batch_number, cur.lot as lot_number, line.l->>'code' as material_code, line.l->>'materialItemId' as material_master_id,
    q.quantity, q.unit, ev.done_at as dispensed_at,
    (v.doc->'stages'->s.stage->>'key') || '/' || (st.step->>'key') as step, cur.event_id,
    case when ev.corrected then 'corrected' else 'dispensed' end as status, now() as read_at, greatest(ev.last, back.at) as data_as_of,
    coalesce(ev.place, (v.doc->'stages'->s.stage->>'name') || ' › ' || (st.step->>'key')) as step_name,
    ret.n as returned, ret.at as returned_at
  from (select distinct batch_id, stage, sub, step, round from step_events where kind = 'done') s
  join batches b on b.id = s.batch_id
  join master_versions v on v.id = b.master_version_id
  cross join lateral (select v.doc->'stages'->s.stage->'steps'->s.step as step) st
  cross join lateral (select st.step->'block'->>'id' as block) k
  cross join lateral (
    select min(x.at) filter (where x.kind = 'done') as done_at, bool_or(x.kind = 'corrected') as corrected, max(x.at) as last,
      (array_agg(x.payload->>'where' order by x.id) filter (where x.kind = 'started'))[1] as place,
      (array_agg(x.payload->>'stockUnit' order by x.id desc) filter (where x.payload ? 'stockUnit'))[1] as stock_unit
    from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step and x.round = s.round
  ) ev
  -- The quantity taken: a weighing's net weight (a result), a liquid's quantity charged or an issue's count (values).
  cross join lateral (
    select n.id as event_id,
      case when k.block = 'weigh' then n.payload->'results'->'net'
           else n.payload->'values'->(case k.block when 'charge-liquid' then 'charged' else 'issued' end) end as net,
      (select x.payload->'values'->>'lot' from step_events x where x.batch_id = s.batch_id and x.stage = s.stage and x.sub = s.sub and x.step = s.step
         and x.round = s.round and x.kind in ('value', 'corrected') and x.payload->'values' ? 'lot' order by x.id desc limit 1) as lot
    from step_events n where n.batch_id = s.batch_id and n.stage = s.stage and n.sub = s.sub and n.step = s.step and n.round = s.round
      and (case when k.block = 'weigh' then n.payload->'results' ? 'net'
                else n.payload->'values' ? (case k.block when 'charge-liquid' then 'charged' else 'issued' end) end)
    order by n.id desc limit 1
  ) cur
  left join lateral (
    select l from jsonb_array_elements(v.doc->'formula') l where l->>'key' = (
      select z.value->>'formula' from jsonb_each(st.step->'settings') z where jsonb_typeof(z.value) = 'object' and z.value ? 'formula' limit 1)
  ) line on true
  -- What the issue's count-back step (the same material, done) says went back to stores unused.
  left join lateral (
    select (bv.v->'returned'->>'value')::numeric as n, bv.at from (
      select (select case when (select z.kind from step_events z where z.batch_id = s.batch_id and z.stage = (si.i - 1)::int and z.sub = 1 and z.step = (sj.j - 1)::int
      and z.round = 1 and z.kind in ('done', 'sent_back') order by z.id desc limit 1) = 'done'
    then (select coalesce(jsonb_object_agg(q.k, q.val), '{}') from (
      select distinct on (x.key) x.key as k, x.value as val from step_events y cross join lateral jsonb_each(y.payload->'values') x
      where y.batch_id = s.batch_id and y.stage = (si.i - 1)::int and y.sub = 1 and y.step = (sj.j - 1)::int and y.round = 1 and y.payload ? 'values'
      order by x.key, y.id desc) q) end) as v,
        (select max(x.at) from step_events x where x.batch_id = s.batch_id and x.stage = (si.i - 1)::int and x.step = (sj.j - 1)::int) as at
      from jsonb_array_elements(v.doc->'stages') with ordinality si(x, i), jsonb_array_elements(si.x->'steps') with ordinality sj(y, j)
      where k.block in ('container-issue', 'pack-material-issue')
        and sj.y->'block'->>'id' = case k.block when 'container-issue' then 'container-return' else 'printed-reconciliation' end
        and sj.y->'settings'->'material'->>'formula' = st.step->'settings'->'material'->>'formula'
    ) bv where bv.v is not null limit 1
  ) back on true
  cross join lateral (select (cur.net->>'value')::numeric - case when k.block = 'container-issue' then least(coalesce(back.n, 0), (cur.net->>'value')::numeric)
                                                                  else coalesce(back.n, 0) end as n,
                             cur.net->>'unit' as u, ev.stock_unit as su) r
  cross join lateral (select
    case when lower(r.su) = 'kg' and r.u = 'g' then r.n * 0.001 when lower(r.su) = 'kg' and r.u = 'mg' then r.n * 0.000001 else r.n end as quantity,
    case when lower(r.su) = 'kg' and r.u in ('kg', 'g', 'mg') then r.su
         when r.u = 'units' and lower(r.su) in ('nos', 'no', 'nos.', 'no.', 'units', 'unit', 'pcs', 'pc', 'pieces', 'each', 'ea', 'numbers') then r.su
         else r.u end as unit) q
  -- what QA said went back to stores of this lot when terminating the batch
  left join lateral (
    select (x->>'value')::numeric as n, t.at from batch_events t cross join jsonb_array_elements(t.payload->'returns') x
    where t.batch_id = s.batch_id and t.kind = 'rejected' and t.payload ? 'returns' and lower(x->>'lot') = lower(cur.lot) and x->>'unit' = q.unit
    limit 1
  ) ret on true
  where k.block in ('weigh', 'charge-liquid', 'container-issue', 'pack-material-issue') and cur.net is not null
    and (k.block <> 'weigh' or (cur.net->>'ok')::boolean)
) w;

create or replace view output_lot_v1 with (security_barrier) as
-- The API (or the intermediate for stores) of each batch.
select b.batch_no as lot_number, case when (v.doc->'header'->>'intermediate')::boolean then 'intermediate' else 'api' end as kind,
  v.doc->'header'->>'productCode' as material_code, v.doc->'header'->>'productItemId' as material_master_id,
  p.net as quantity, 'kg'::text as unit, p.containers, f.manufactured_on,
  least((date_trunc('month', f.manufactured_on) + make_interval(months => (v.doc->'header'->>'retestMonths')::int))::date - 1, api.until) as retest_on,
  f.released, f.released_at, b.batch_no as batch_number, now() as read_at, f.data_as_of
from batches b
join master_versions v on v.id = b.master_version_id
join batch_fact_v1 f on f.batch_number = b.batch_no
-- The containers filled (container-fill rounds done): their net weights as last recorded.
left join lateral (
  select round(sum((c.r->'net'->>'value')::numeric), 3) as net, count(*)::int as containers from (
    select (select y.payload->'results' from step_events y where y.batch_id = b.id and y.stage = r.stage and y.sub = r.sub and y.step = r.step
              and y.round = r.round and y.payload->'results' ? 'net' order by y.id desc limit 1) as r
    from (select distinct x.stage, x.sub, x.step, x.round from step_events x where x.batch_id = b.id and x.kind = 'done') r
    where v.doc->'stages'->r.stage->'steps'->r.step->'block'->>'id' = 'container-fill'
      and (select case when (select z.kind from step_events z where z.batch_id = b.id and z.stage = r.stage and z.sub = r.sub and z.step = r.step
      and z.round = r.round and z.kind in ('done', 'sent_back') order by z.id desc limit 1) = 'done'
    then (select coalesce(jsonb_object_agg(q.k, q.val), '{}') from (
      select distinct on (x.key) x.key as k, x.value as val from step_events y cross join lateral jsonb_each(y.payload->'values') x
      where y.batch_id = b.id and y.stage = r.stage and y.sub = r.sub and y.step = r.step and y.round = r.round and y.payload ? 'values'
      order by x.key, y.id desc) q) end) is not null
  ) c where (c.r->'net'->>'ok')::boolean
) p on true
-- TA-25: the earliest retest or expiry date of the lots of this API used in the batch (a blend, a reprocessing).
left join lateral (
  select min((x.payload->'values'->>'lot.expiry')::date) as until
  from step_events x
  join lateral (select z.value->>'formula' as k from jsonb_each(v.doc->'stages'->x.stage->'steps'->x.step->'settings') z
                where jsonb_typeof(z.value) = 'object' and z.value ? 'formula' limit 1) fl on true
  join lateral (select l from jsonb_array_elements(v.doc->'formula') l where l->>'key' = fl.k) line on true
  where x.batch_id = b.id and x.payload->'values' ? 'lot.expiry' and line.l->>'materialItemId' = v.doc->'header'->>'productItemId'
    and (x.payload->'values'->>'lot.expiry') ~ '^\d{4}-\d{2}-\d{2}$'
) api on true
union all
-- TA-24: each solvent sent to recovery, as a lot of the recovered material its formula line names.
select b.batch_no || '-R' || row_number() over (partition by b.id order by r.stage, r.sub, r.step, r.round) as lot_number, 'recovered solvent' as kind,
  line.l->'recovered'->>'code' as material_code, line.l->'recovered'->>'materialItemId' as material_master_id,
  (vals.v->'toRecovery'->>'value')::numeric as quantity, vals.v->'toRecovery'->>'unit' as unit,
  nullif(vals.v->'recoveryContainers'->>'value', '')::numeric::int as containers,
  (r.done_at at time zone 'Asia/Kolkata')::date as manufactured_on, null::date as retest_on,
  false as released, null::timestamptz as released_at, b.batch_no as batch_number, now() as read_at, r.done_at as data_as_of
from batches b
join master_versions v on v.id = b.master_version_id
join lateral (
  select x.stage, x.sub, x.step, x.round, max(x.at) as done_at from step_events x where x.batch_id = b.id and x.kind = 'done'
  group by x.stage, x.sub, x.step, x.round
) r on true
cross join lateral (select (select case when (select z.kind from step_events z where z.batch_id = b.id and z.stage = r.stage and z.sub = r.sub and z.step = r.step
      and z.round = r.round and z.kind in ('done', 'sent_back') order by z.id desc limit 1) = 'done'
    then (select coalesce(jsonb_object_agg(q.k, q.val), '{}') from (
      select distinct on (x.key) x.key as k, x.value as val from step_events y cross join lateral jsonb_each(y.payload->'values') x
      where y.batch_id = b.id and y.stage = r.stage and y.sub = r.sub and y.step = r.step and y.round = r.round and y.payload ? 'values'
      order by x.key, y.id desc) q) end) as v) vals
join lateral (select l from jsonb_array_elements(v.doc->'formula') l
              where l->>'key' = v.doc->'stages'->r.stage->'steps'->r.step->'settings'->'solvent'->>'formula' and l ? 'recovered') line on true
where vals.v is not null and (vals.v->'toRecovery'->>'value')::numeric > 0;

reset search_path;
