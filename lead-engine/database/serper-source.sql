-- Sourcing only: never changes companies, qualifications, timers or paid model runs.
begin;
create or replace function public.le_serper_source(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare k text; versions jsonb; old jsonb; item jsonb; d text; items jsonb:='[]'; n integer;
begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKEND_ONLY' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(9242026,100);
 if p_action='status' then
  return jsonb_build_object('requests_reserved',(select count(*) from lead_engine.events where event_type='SERPER_REQUEST_RESERVED'),
   'requests_completed',(select count(*) from lead_engine.events where event_type='SERPER_REQUEST_FINISHED'),
   'candidate_records',(select coalesce(sum(jsonb_array_length(details->'candidates')),0) from lead_engine.events where event_type='SERPER_REQUEST_FINISHED'),
   'approved_added',0,'stage','SOURCING_ONLY');
 end if;
 select jsonb_object_agg(b.slug,v.id::text) into versions from public.bibles b join public.bible_versions v on v.bible_id=b.id and v.version=b.current_version where b.slug in ('lead-intelligence-bible','schilders-niche-bible','cold-email-bible','lead-engine-chat-context');
 if not exists(select 1 from lead_engine.events where id::text=p_payload->>'start_receipt_id' and event_type='BIBLE_START_RECEIPT' and created_at>now()-interval '24 hours' and details->'versions'=versions) then raise exception 'CURRENT_BIBLE_START_REQUIRED'; end if;
 k:=p_payload->>'request_key';
 if k is null or k!~'^[a-f0-9]{64}$' then raise exception 'INVALID_REQUEST_KEY'; end if;
 if p_action='reserve' then
  if exists(select 1 from lead_engine.events where event_type='SERPER_REQUEST_RESERVED' and entity_id=k) then return jsonb_build_object('allowed',false,'reason','ALREADY_RESERVED_NO_RETRY'); end if;
  select count(*) into n from lead_engine.events where event_type='SERPER_REQUEST_RESERVED';
  if n>=40 then return jsonb_build_object('allowed',false,'reason','SEARCH_LIMIT'); end if;
  if length(coalesce(p_payload->>'query','')) not between 1 and 200 or (p_payload->>'page')::integer not between 1 and 3 then raise exception 'INVALID_SEARCH'; end if;
  insert into lead_engine.events(entity_type,entity_id,event_type,actor,details) values('serper_request',k,'SERPER_REQUEST_RESERVED','serper-source-v1',jsonb_build_object('query',p_payload->>'query','page',p_payload->'page','start_receipt_id',p_payload->>'start_receipt_id','account_mode','FREE_TRIAL_EXPECTED','external_cost_verified',false));
  return jsonb_build_object('allowed',true);
 elsif p_action='finish' then
  if not exists(select 1 from lead_engine.events where event_type='SERPER_REQUEST_RESERVED' and entity_id=k) then raise exception 'RESERVATION_REQUIRED'; end if;
  select details into old from lead_engine.events where event_type='SERPER_REQUEST_FINISHED' and entity_id=k;
  if found then return jsonb_build_object('saved',true,'replayed',true,'candidates',jsonb_array_length(old->'candidates')); end if;
  if jsonb_typeof(p_payload->'candidates') is distinct from 'array' then raise exception 'CANDIDATES_REQUIRED'; end if;
  if jsonb_array_length(p_payload->'candidates')>10 or octet_length(p_payload::text)>60000 then raise exception 'PAYLOAD_TOO_LARGE'; end if;
  for item in select value from jsonb_array_elements(p_payload->'candidates') loop
   d:=lower(item->>'domain');
   if d is null or d!~'^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$' or item->>'website' is distinct from 'https://'||d||'/' then raise exception 'INVALID_CANDIDATE_DOMAIN'; end if;
   if not exists(select 1 from lead_engine.companies c where regexp_replace(lower(c.domain),'^www\.','')=d)
    and not exists(select 1 from lead_engine.events e cross join lateral jsonb_array_elements(e.details->'candidates') x where e.event_type='SERPER_REQUEST_FINISHED' and x->>'domain'=d)
    and not exists(select 1 from jsonb_array_elements(items) x where x->>'domain'=d) then
    items:=items||jsonb_build_array(item||jsonb_build_object('status','UNREVIEWED_SOURCE','qualified',false));
   end if;
  end loop;
  insert into lead_engine.events(entity_type,entity_id,event_type,actor,details) values('serper_request',k,'SERPER_REQUEST_FINISHED','serper-source-v1',jsonb_build_object('candidates',items,'provider_credits',p_payload->'provider_credits','error_code',p_payload->>'error_code','observed_at',p_payload->>'observed_at','qualification','NOT_PERFORMED'));
  return jsonb_build_object('saved',true,'candidates',jsonb_array_length(items));
 end if;
 raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.le_serper_source(text,jsonb) from public,anon,authenticated;
grant execute on function public.le_serper_source(text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
