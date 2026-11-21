-- Fix round 21 Nov 2026 (A7): material_use_v1 leaves out a weighing undone to weigh another lot until it is signed
-- done again (then its lot and quantity are the new ones: the last recorded). Same name, columns and meaning (0018),
-- replaced in place.
do $$
declare
  rep text := case when current_schema() = 'public' then 'report' else current_schema() || '_report' end;
begin
  perform set_config('search_path', format('%I, %I', rep, current_schema()), true);
end $$;

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
  -- A7: signed done since it was last undone (an undone weighing is not used until it is signed again).
  from (select distinct d.batch_id, d.stage, d.sub, d.step, d.round from step_events d where d.kind = 'done'
    and not exists (select 1 from step_events u where u.batch_id = d.batch_id and u.stage = d.stage and u.sub = d.sub and u.step = d.step
      and u.round = d.round and u.kind = 'undone' and u.id > d.id)) s
  join batches b on b.id = s.batch_id
  join master_versions v on v.id = b.master_version_id
  cross join lateral (select v.doc->'stages'->s.stage->'steps'->s.step as step) st
  cross join lateral (select st.step->'block'->>'id' as block) k
  cross join lateral (
    select min(x.at) filter (where x.kind = 'done' and x.id > coalesce((select max(u.id) from step_events u where u.batch_id = s.batch_id and u.stage = s.stage and u.sub = s.sub and u.step = s.step and u.round = s.round and u.kind = 'undone'), 0)) as done_at, bool_or(x.kind = 'corrected') as corrected, max(x.at) as last,
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

reset search_path;
