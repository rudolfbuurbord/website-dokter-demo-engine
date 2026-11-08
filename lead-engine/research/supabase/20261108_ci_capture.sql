create or replace function public.le_ci_capture(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r lead_engine.research_runs; t lead_engine.research_tasks; result jsonb;
begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKEND_ONLY'; end if;
 if now()>'2026-11-09T06:00:00Z'::timestamptz then raise exception 'CI_RUN_WINDOW_EXPIRED'; end if;
 select * into strict r from lead_engine.research_runs where run_key='dwd-call-ready-20261108-free5';
 if r.budget_usd<>0 then raise exception 'FREE_RUN_REQUIRED'; end if;
 if p_action='state' then
  result:=public.le_call_capture_control('heartbeat',jsonb_build_object('status',coalesce(p_payload->>'status','CI_POLLING'),'release','github-oidc-free','processed',coalesce((p_payload->>'processed')::int,0)));
  return jsonb_set(result,'{runs}',case when r.status='ACTIVE' then jsonb_build_array(jsonb_build_object('id',r.id)) else '[]'::jsonb end);
 elsif p_action='start' then
  return public.le_command('start_work',jsonb_build_object('actor','github-oidc-capture','task','Free website evidence capture for existing CALL300 run'));
 elsif p_action='claim' then
  if (p_payload->>'run_id')::uuid<>r.id then raise exception 'RUN_SCOPE'; end if;
  return public.le_research('claim',p_payload);
 elsif p_action in ('finish','upload_check') then
  select * into strict t from lead_engine.research_tasks where id=(p_payload->>'task_id')::uuid and run_id=r.id;
  if t.lease_token is distinct from (p_payload->>'lease_token')::uuid or t.status<>'RUNNING' or t.lease_until<now() then raise exception 'LEASE_REQUIRED'; end if;
  if p_action='upload_check' then return jsonb_build_object('run_id',r.id,'task_id',t.id,'lease_token',t.lease_token); end if;
  if octet_length((p_payload->'output')::text)>200000 then raise exception 'OUTPUT_LIMIT'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_payload->'output'->'images','[]'::jsonb)) im where im->>'bucket'<>'lead-research-evidence' or im->>'path' not like r.id::text||'/'||t.id::text||'/'||t.lease_token::text||'/%' or position('..' in im->>'path')>0) then raise exception 'IMAGE_SCOPE'; end if;
  return public.le_research('finish',p_payload);
 end if;
 raise exception 'ACTION_NOT_ALLOWED';
end $$;
revoke all on function public.le_ci_capture(text,jsonb) from public,anon,authenticated;
grant execute on function public.le_ci_capture(text,jsonb) to service_role;