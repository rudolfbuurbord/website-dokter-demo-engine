-- Cumulative budget remains unchanged; no new paid request during replay.
create or replace view lead_engine.budget100_current_results with (security_invoker=true) as
 select e.entity_id as domain, e.details || case when m.id is not null then jsonb_build_object('status',m.qualification,'historical_status',e.details->>'status') else '{}'::jsonb end as result
 from lead_engine.events e left join lead_engine.list_members m on m.id::text=e.details->>'member_id'
 where e.event_type in ('BUDGET100_FINISHED','BUDGET100_SKIPPED');
revoke all on lead_engine.budget100_current_results from public, anon, authenticated;
grant select on lead_engine.budget100_current_results to service_role;
CREATE OR REPLACE FUNCTION public.le_budget_qualification(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 k text:=p_payload->>'key'; v jsonb; old jsonb; candidate jsonb; res jsonb; cid uuid; rid uuid; mid uuid; a jsonb; e jsonb;
 used bigint; amount bigint; listid uuid:='751209ff-df19-4037-bd6e-ab00a35007d0';
begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKEND_ONLY'; end if;
 perform pg_advisory_xact_lock(9242026,101);
 if p_action='status' then
  return jsonb_build_object('approved',(select count(*) from lead_engine.budget100_current_results where result->>'status'='APPROVED'),
  'rejected',(select count(*) from lead_engine.budget100_current_results where result->>'status'='REJECTED'),
  'results',(select coalesce(jsonb_agg(jsonb_build_object('domain',domain,'result',result)),'[]') from lead_engine.budget100_current_results),
  'recoverable_keys',(select coalesce(jsonb_agg(entity_id),'[]') from lead_engine.events where event_type='BUDGET100_REPLAY_BACKUP'),
  'control',coalesce((select details from lead_engine.events where event_type='BUDGET100_CONTROL' order by id desc limit 1),'{"mode":"REPLAY_ONLY"}'::jsonb),
  'source_requests',(select count(*) from lead_engine.events where event_type='SERPER_REQUEST_FINISHED'),
  'source_candidates',(select count(distinct x->>'domain') from lead_engine.events e cross join lateral jsonb_array_elements(e.details->'candidates') x where e.event_type='SERPER_REQUEST_FINISHED'),
  'worker',(select details||jsonb_build_object('at',created_at) from lead_engine.events where event_type='BUDGET100_HEARTBEAT' order by id desc limit 1),
  'costs',(select coalesce(jsonb_agg(jsonb_build_object('key',r.entity_id,'reserved_micro_eur',r.details->'amount','settlement',s.details)),'[]') from lead_engine.events r left join lead_engine.events s on s.entity_id=r.entity_id and s.event_type='BUDGET100_SETTLED' where r.event_type='BUDGET100_RESERVED'),
  'calibration',(select details from lead_engine.events where event_type='BUDGET100_CALIBRATED' order by id desc limit 1));
 end if;
 select jsonb_object_agg(b.slug,bv.id::text) into v from public.bibles b join public.bible_versions bv on bv.bible_id=b.id and bv.version=b.current_version where b.slug in ('lead-intelligence-bible','schilders-niche-bible','cold-email-bible','lead-engine-chat-context');
 if not exists(select 1 from lead_engine.events where id::text=p_payload->>'start_receipt_id' and event_type='BIBLE_START_RECEIPT' and created_at>now()-interval '24 hours' and details->'versions'=v) then raise exception 'CURRENT_BIBLE_START_REQUIRED'; end if;
 if p_action='candidates' then
  return (select coalesce(jsonb_agg(x),'[]') from lead_engine.events es cross join lateral jsonb_array_elements(es.details->'candidates') x where es.event_type='SERPER_REQUEST_FINISHED'
   and not exists(select 1 from lead_engine.companies c where regexp_replace(lower(c.domain),'^www[.]','')=x->>'domain')
   and not exists(select 1 from lead_engine.events done where done.entity_id=x->>'domain' and done.event_type='BUDGET100_FINISHED'));
 end if;
 if k is null or length(k)>250 then raise exception 'KEY_REQUIRED'; end if;
 if p_action in ('reserve','finish','calibrate','reject','backup','heartbeat','audit','restore') and coalesce(p_payload->>'protocol_version','')<>'budget100-proof-v2' then raise exception 'POLICY_REPAIR_REQUIRED'; end if;
 if p_action='precheck' then
  return jsonb_build_object('exists',exists(select 1 from lead_engine.companies where regexp_replace(lower(domain),'^www[.]','')=lower(p_payload->>'canonical_domain')));
 end if;
 if p_action='restore' then return coalesce((select details from lead_engine.events where event_type='BUDGET100_REPLAY_BACKUP' and entity_id=k order by id desc limit 1),'{}'::jsonb); end if;
 if p_action in ('backup','audit','heartbeat') then
  if p_action in ('backup','audit') and not exists(select 1 from lead_engine.events where entity_id=k and event_type in ('BUDGET100_RESERVED','BUDGET100_FINISHED','BUDGET100_SKIPPED')) then raise exception 'KNOWN_CANDIDATE_REQUIRED'; end if;
  if pg_column_size(p_payload)>350000 then raise exception 'CHECKPOINT_TOO_LARGE'; end if;
  if p_action='backup' then
   if jsonb_typeof(p_payload->'data') is distinct from 'object' then raise exception 'BACKUP_REQUIRED'; end if;
   if exists(select 1 from lead_engine.events where entity_id=k and event_type='BUDGET100_REPLAY_BACKUP') then return '{"saved":true,"replayed":true}'::jsonb; end if;
  end if;
  insert into lead_engine.events(entity_type,entity_id,event_type,actor,details) values('budget_test',k,case p_action when 'backup' then 'BUDGET100_REPLAY_BACKUP' when 'audit' then 'BUDGET100_REPAIR_AUDIT' else 'BUDGET100_HEARTBEAT' end,'budget-worker-v2',p_payload-'start_receipt_id');
  return '{"saved":true}'::jsonb;
 end if;
 if p_action='reject' then
  if p_payload->>'reason_code' is distinct from 'NOT_TARGET_BUSINESS' or not lead_engine.sourced_route_evidence_ok(p_payload->'evidence') then raise exception 'SOURCED_BUSINESS_REJECTION_REQUIRED'; end if;
  if not exists(select 1 from lead_engine.events e cross join lateral jsonb_array_elements(e.details->'candidates') x where e.event_type='SERPER_REQUEST_FINISHED' and x->>'domain'=k) then raise exception 'SOURCE_CANDIDATE_REQUIRED'; end if;
  select result into old from lead_engine.budget100_current_results where domain=k and result->>'status' in ('APPROVED','REJECTED');
  if found then return old||'{"replayed":true}'::jsonb; end if;
  res:=jsonb_build_object('status','REJECTED','reason',p_payload->>'reason','reason_code','NOT_TARGET_BUSINESS','evidence',p_payload->'evidence','visual_evidence',p_payload->'visual_evidence','metrics',p_payload->'metrics','protocol_version',p_payload->>'protocol_version','decision_scope','SOURCE_CANDIDATE');
  update lead_engine.events set event_type='BUDGET100_PREVIOUS_SKIP' where entity_id=k and event_type='BUDGET100_SKIPPED';
  insert into lead_engine.events(entity_type,entity_id,event_type,actor,details) values('budget_test',k,'BUDGET100_FINISHED','budget-worker-v2',res);
  return res;
 end if;
 if p_action='reserve' then
  if coalesce((select details->>'mode' from lead_engine.events where event_type='BUDGET100_CONTROL' order by id desc limit 1),'REPLAY_ONLY')<>'RUN' then return '{"allowed":false,"reason":"REPLAY_ONLY"}'::jsonb; end if;
  if exists(select 1 from lead_engine.events where event_type='BUDGET100_RESERVED' and entity_id=k) then return jsonb_build_object('allowed',false,'reason','NO_PAID_RETRY'); end if;
  amount:=(p_payload->>'amount')::bigint;
  if amount is null or amount<1 or amount>900000 then raise exception 'INVALID_RESERVATION'; end if;
  -- €0.10 retained for all source requests, storage and variable infrastructure.
  select 100000+coalesce(sum(coalesce((s.details->>'amount')::bigint,(r.details->>'amount')::bigint)),0) into used from lead_engine.events r left join lead_engine.events s on s.entity_id=r.entity_id and s.event_type='BUDGET100_SETTLED' where r.event_type='BUDGET100_RESERVED';
  if used+amount>1000000 then return jsonb_build_object('allowed',false,'reason','EURO_CAP_REACHED','committed_micro_eur',used); end if;
  insert into lead_engine.events(entity_type,entity_id,event_type,actor,details) values('budget_test',k,'BUDGET100_RESERVED','budget-worker-v1',jsonb_build_object('amount',amount,'stage',p_payload->>'stage','versions',v));
  return '{"allowed":true}'::jsonb;
 elsif p_action='settle' then
  select details into old from lead_engine.events where event_type='BUDGET100_SETTLED' and entity_id=k;
  if found then
   if old->>'provider_request_id' is distinct from p_payload->>'provider_request_id' then raise exception 'SETTLEMENT_CONFLICT'; end if;
   return old;
  end if;
  if exists(select 1 from lead_engine.events where event_type='BUDGET100_SETTLED' and entity_id<>k and details->>'provider_request_id'=p_payload->>'provider_request_id') then raise exception 'SETTLEMENT_PROVIDER_REUSED'; end if;
  select (details->>'amount')::bigint into used from lead_engine.events where event_type='BUDGET100_RESERVED' and entity_id=k;
  amount:=(p_payload->>'amount')::bigint;
  if used is null or amount is null or amount<0 or nullif(p_payload->>'provider_request_id','') is null then raise exception 'INVALID_SETTLEMENT'; end if;
  insert into lead_engine.events(entity_type,entity_id,event_type,actor,details) values('budget_test',k,'BUDGET100_SETTLED','budget-worker-v1',p_payload-'start_receipt_id');
  return jsonb_build_object('saved',true,'overrun',amount>used);
 elsif p_action='calibrate' then
  if coalesce(p_payload->>'prompt_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'CALIBRATION_PROMPT_PROVENANCE_REQUIRED'; end if;
  if p_payload->>'prompt_hash' is distinct from p_payload->>'inference_prompt_hash' then raise exception 'CALIBRATION_PROMPT_PROVENANCE_REQUIRED'; end if;
  if (select count(distinct x->>'url') from jsonb_array_elements(p_payload->'checks') x where x->>'actual'=x->>'expected' and jsonb_array_length(x->'evidence')>0 and
    ((x->>'expected'='ELIGIBLE' and x->>'url' in ('https://dusinkschildersbedrijf.nl/','https://alferink-schilderwerken.nl/schildersbedrijf-enschede/','https://vanheek.nl/uw-schildersbedrijf-in-enschede/')) or
     (x->>'expected'='INELIGIBLE' and x->>'url' in ('https://www.schildersbedrijfwestenberg.nl/','https://www.ronaldschilderwerken.nl/'))))<>5 then raise exception 'REFERENCE_CALIBRATION_FAILED'; end if;
  insert into lead_engine.events(entity_type,entity_id,event_type,actor,details) values('budget_test',k,'BUDGET100_CALIBRATED','budget-worker-v1',p_payload||jsonb_build_object('versions',v));
  return '{"calibrated":true}'::jsonb;
 elsif p_action in ('skip','finish') then
  select details into old from lead_engine.events where entity_id=k and event_type in ('BUDGET100_FINISHED','BUDGET100_SKIPPED');
  if found and old->>'status' in ('APPROVED','REJECTED') then return old||'{"replayed":true}'::jsonb; end if;
  if found and p_action='skip' then
   update lead_engine.events set event_type='BUDGET100_PREVIOUS_SKIP' where entity_id=k and event_type='BUDGET100_SKIPPED';
  end if;
  select x into candidate from lead_engine.events es cross join lateral jsonb_array_elements(es.details->'candidates') x where es.event_type='SERPER_REQUEST_FINISHED' and x->>'domain'=k limit 1;
  if candidate is null then raise exception 'SOURCE_CANDIDATE_REQUIRED'; end if;
  if p_action='skip' then
   res:=jsonb_build_object('status','SKIPPED','reason',p_payload->>'reason','metrics',p_payload->'metrics','evidence',p_payload->'evidence','protocol_version',p_payload->>'protocol_version');
  else
   if coalesce(p_payload->>'canonical_domain',k) !~ '^[a-z0-9][a-z0-9.-]*[.][a-z]{2,}$' then raise exception 'VALID_CANONICAL_DOMAIN_REQUIRED'; end if;
   if not exists(select 1 from lead_engine.events where event_type='BUDGET100_SETTLED' and entity_id=k and details->>'provider_request_id'=p_payload->>'provider_request_id') then raise exception 'SETTLED_MODEL_RESPONSE_REQUIRED'; end if;
   if (select count(*) from lead_engine.budget100_current_results where result->>'status'='APPROVED')>=100 then raise exception 'TARGET_REACHED'; end if;
   if not exists(select 1 from lead_engine.events where event_type='BUDGET100_CALIBRATED' and details->'versions'=v and details->>'model'=p_payload->>'model' and details->>'prompt_hash'=p_payload->>'prompt_hash') then raise exception 'CALIBRATION_REQUIRED'; end if;
   if exists(select 1 from lead_engine.companies where regexp_replace(lower(domain),'^www[.]','') in (k,coalesce(p_payload->>'canonical_domain',k)) or lower(trim(name))=lower(trim(p_payload->>'company_name')))
    or exists(select 1 from lead_engine.contact_routes where lower(value)=lower(p_payload->'contact'->>'value') and kind='EMAIL') then raise exception 'EXISTING_COMPANY_OR_EMAIL_SKIP'; end if;
   if nullif(trim(p_payload->>'company_name'),'') is null or p_payload->>'country' is distinct from 'NL' then raise exception 'SOURCED_IDENTITY_REQUIRED'; end if;
   res:=public.le_command('ingest',jsonb_build_object('source','serper-budget100','external_id',k,'source_url',candidate->>'source_url','company_name',p_payload->>'company_name','website','https://'||coalesce(p_payload->>'canonical_domain',k)||'/','niche','schilders','country','NL','start_receipt_id',p_payload->>'start_receipt_id'));
   cid:=(res->>'company_id')::uuid;
   if cid is null then raise exception 'INGEST_FAILED'; end if;
   update lead_engine.jobs set status='BLOCKED',error_code='BUDGET_TEST_CAPTURE_SUPPLIED',error_detail='Dedicated budget test supplies capture; do not launch a duplicate audit.',updated_at=now() where company_id=cid and kind='WEBSITE_AUDIT' and status='QUEUED';
   -- Strictly scoped to a newly ingested company; existing members never touched.
   if exists(select 1 from lead_engine.list_members where company_id=cid) then raise exception 'EXISTING_MEMBER_SKIP'; end if;
   res:=public.le_command('contact',(p_payload->'contact')||jsonb_build_object('company_id',cid,'kind','EMAIL','is_inferred',false));
   rid:=(res->>'route_id')::uuid;
   update lead_engine.contact_routes set reader_certainty='EVIDENCED',enabled=true where id=rid;
   res:=public.le_command('add_member',jsonb_build_object('list_id',listid,'company_id',cid,'route_id',rid,'reason','ANGLE_01 VAKWERK_UITSTRALING budgettest','snapshot',jsonb_build_object('test','budget100-v1','source',candidate),'start_receipt_id',p_payload->>'start_receipt_id'));
   mid:=(res->>'member_id')::uuid;
   res:=public.le_command('complete_qualification',(p_payload->'qualification')||jsonb_build_object('member_id',mid,'route_id',rid,'reviewer','budget-worker-v1','start_receipt_id',p_payload->>'start_receipt_id'));
   if res->>'status' is distinct from (case when p_payload->'qualification'->'assessment'->'value'->>'status'='ELIGIBLE' then 'APPROVED' else 'REJECTED' end) then raise exception 'PRODUCTION_GATE_MISMATCH'; end if;
   res:=res||jsonb_build_object('metrics',p_payload->'metrics','model',p_payload->>'model','provider_request_id',p_payload->>'provider_request_id','evidence',p_payload->'evidence','protocol_version',p_payload->>'protocol_version');
  end if;
  if p_action='finish' then
   update lead_engine.events set event_type='BUDGET100_PREVIOUS_SKIP' where entity_id=k and event_type='BUDGET100_SKIPPED';
  end if;
  insert into lead_engine.events(entity_type,entity_id,event_type,actor,details) values('budget_test',k,case when p_action='skip' then 'BUDGET100_SKIPPED' else 'BUDGET100_FINISHED' end,'budget-worker-v1',res);
  return res;
 end if;
 raise exception 'UNKNOWN_ACTION';
end $function$;
revoke all on function public.le_budget_qualification(text,jsonb) from public,anon,authenticated;
grant execute on function public.le_budget_qualification(text,jsonb) to service_role;
