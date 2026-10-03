DO $migration$
DECLARE source text; anchor text:='  if exists(select 1 from lead_engine.events where event_type=''BUDGET100_RESERVED'''; replacement text;
BEGIN
source:=pg_get_functiondef('public.le_budget_qualification(text,jsonb)'::regprocedure);
IF position('COHORT_NOT_AUTHORIZED' in source)>0 THEN RETURN;END IF;
IF position(anchor in source)=0 THEN RAISE EXCEPTION 'RESERVE_ANCHOR_MISSING';END IF;
replacement:=$guard$  select details into a from lead_engine.events where event_type='BUDGET100_CONTROL' order by id desc limit 1;
  if a->>'cohort_id' is distinct from 'pilot50-2026-10-03'
   or p_payload->>'cohort_id' is distinct from a->>'cohort_id'
   or jsonb_typeof(a->'keys') is distinct from 'array'
   or jsonb_array_length(a->'keys')<>50
   or not (a->'keys' ? k)
   or now()>='2026-10-04T00:00:00Z'::timestamptz
   then return jsonb_build_object('allowed',false,'reason','COHORT_NOT_AUTHORIZED');end if;
$guard$||anchor;
EXECUTE replace(source,anchor,replacement);
END $migration$;