CREATE OR REPLACE FUNCTION lead_engine.complete_saved_dossier(p_member uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $fn$
declare m lead_engine.list_members; a lead_engine.observations; b jsonb; pages jsonb; imgs jsonb;
urls jsonb; facts jsonb; ts timestamptz; d jsonb; provider text; domain_key text;
begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKEND_ONLY';end if;
 select * into m from lead_engine.list_members where id=p_member for update;
 if not found then raise exception 'MEMBER_NOT_FOUND';end if;
 d:=lead_engine.gate_before_handoff(p_member);
 if m.qualification<>'APPROVED' or d->'reasons' ?| array['QUALITY_AUDIT_REVIEW_REQUIRED','QUALITY_AUDIT_BUSINESS_REJECTED'] then
 return jsonb_build_object('completed',false,'reasons',d->'reasons','qualification',m.qualification);end if;
 d:=lead_engine.email_dossier(p_member);
 if (d->>'allowed')::boolean then return jsonb_build_object('completed',true,'replayed',true);end if;
 select * into a from lead_engine.observations where company_id=m.company_id and field='website_outreach_assessment'
 order by observed_at desc,created_at desc,id desc limit 1;
 select entity_id,details->>'provider_request_id' into domain_key,provider from lead_engine.events
 where event_type='BUDGET100_FINISHED' and details->>'member_id'=p_member::text order by id desc limit 1;
 if provider is null then raise exception 'PAID_REVIEW_PROVENANCE_REQUIRED';end if;
 select details->'data' into b from lead_engine.events where event_type='BUDGET100_REPLAY_BACKUP'
 and entity_id=domain_key order by id desc limit 1;
 if coalesce(b->'review'->>'provider_request_id',b->'answer'->>'id') is distinct from provider then raise exception 'BACKUP_PROVIDER_MISMATCH';end if;
 pages:=coalesce(b->'review'->'pages',b->'capture'->'pages');
 imgs:=coalesce(b->'review'->'evidence',b->'evidence',b->'capture'->'images');
 if jsonb_typeof(pages) is distinct from 'array' or jsonb_array_length(pages)=0
 or jsonb_typeof(imgs) is distinct from 'array' or jsonb_array_length(imgs)=0 then raise exception 'SAVED_SCOPE_REQUIRED';end if;
 select jsonb_agg(distinct coalesce(x->>'source_url',x->>'url')) into urls from jsonb_array_elements(imgs) x
 where coalesce(x->>'source_url',x->>'url') ~ '^https?://';
 if urls is null then raise exception 'SAVED_SCREENSHOT_URL_REQUIRED';end if;
 select min((x->>'observed_at')::timestamptz),jsonb_agg(jsonb_build_object(
 'url',x->>'url','observed_at',x->>'observed_at','http_status',x->'status',
 'forms_observed',x->'forms','interpretation','Stored capture facts only; not an independent functional test.'))
 into ts,facts from jsonb_array_elements(pages) x;
 if ts is null or ts not between now()-interval '30 days' and now()+interval '5 minutes' then raise exception 'SAVED_CAPTURE_STALE';end if;
 insert into lead_engine.observations(company_id,field,layer,value,source_url,observed_at,method)
 values(m.company_id,'website_outreach_assessment','DERIVED_FEATURE',
 a.value||jsonb_build_object('holistic_impression',a.value->>'reason','reviewed_urls',urls,
 'strengths','[]'::jsonb,'unknowns',jsonb_build_array(
 'Sterke punten zijn niet afzonderlijk beoordeeld in de opgeslagen modelronde.',
 'Mobiele weergave, formulieren, volledige navigatie, assets en performance zijn niet functioneel getest.'),
 'desktop_reviewed',true,'mobile_review_status','NOT_TESTED','dossier_enrichment',
 jsonb_build_object('method','saved-dossier-v1','source_assessment_id',a.id,'provider_request_id',provider,'completed_at',now(),'new_research',false)),
 a.source_url,a.observed_at,'saved-dossier-v1');
 insert into lead_engine.observations(company_id,field,layer,value,source_url,observed_at,method)
 values(m.company_id,'website_technical_review','RAW_FACT',jsonb_build_object(
 'reviewer','saved-dossier-v1','scope','Administratieve reconstructie van opgeslagen desktopcapture; geen nieuwe of onafhankelijke functionele test.',
 'checks',jsonb_build_object('reachability','NOT_TESTED','navigation','NOT_TESTED','assets','NOT_TESTED',
 'mobile','NOT_TESTED','contact_flow','NOT_TESTED','forms','NOT_TESTED','basics','NOT_TESTED'),
 'findings','[]'::jsonb,'limitations',jsonb_build_array(
 'Alleen opgeslagen capturefeiten; deze bewijzen geen actuele bereikbaarheid of algemene technische gezondheid.',
 'Geen formulier verzonden, geen mobiele test en geen technische defecten vastgesteld.'),
 'capture_observations',facts,'provider_request_id',provider,'recorded_at',now()),
 pages->0->>'url',ts,'saved-dossier-v1');
 d:=lead_engine.email_dossier(p_member);
 if (d->>'allowed')::boolean is distinct from true then raise exception 'DOSSIER_INCOMPLETE: %',d->'reasons';end if;
 insert into lead_engine.events(entity_type,entity_id,event_type,actor,details)
 values('list_member',p_member::text,'SAVED_DOSSIER_COMPLETED','saved-dossier-v1',
 jsonb_build_object('source_assessment_id',a.id,'provider_request_id',provider,'new_paid_calls',0,
 'technical_tests_performed',false,'send_authorized',false));
 return jsonb_build_object('completed',true,'send_authorized',false);
end $fn$;
REVOKE ALL ON FUNCTION lead_engine.complete_saved_dossier(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION lead_engine.complete_saved_dossier(uuid) TO service_role;

CREATE OR REPLACE FUNCTION lead_engine.complete_qualification(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 m lead_engine.list_members; c lead_engine.companies; a lead_engine.observations;
 r lead_engine.contact_routes; versions jsonb; facts jsonb; activity jsonb; identity jsonb;
 reasons text[]:='{}'; g jsonb; result jsonb; outcome text; actor text;
 activity_ok boolean:=false; identity_ok boolean:=false; event_date date;
 assessment jsonb; ev jsonb; field_name text;
begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKEND_ONLY'; end if;
 select jsonb_object_agg(b.slug,v.id::text) into versions
 from public.bibles b join public.bible_versions v on v.bible_id=b.id and v.version=b.current_version
 where b.slug in ('lead-intelligence-bible','schilders-niche-bible','cold-email-bible','lead-engine-chat-context');
 if not exists(select 1 from lead_engine.events e where e.id::text=p->>'start_receipt_id'
 and e.event_type='BIBLE_START_RECEIPT' and e.created_at between now()-interval '24 hours' and now()
 and e.details->'versions'=versions) then raise exception 'CURRENT_BIBLE_START_REQUIRED'; end if;
 actor:=nullif(trim(p->>'reviewer'),'');
 if actor is null then raise exception 'REVIEWER_REQUIRED'; end if;
 select * into m from lead_engine.list_members where id=(p->>'member_id')::uuid for update;
 if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
 select * into c from lead_engine.companies where id=m.company_id for update;
 facts:=coalesce(m.selection_snapshot->'qualification_facts','{}'::jsonb);
 foreach field_name in array array['activity','identity'] loop
  if p ? field_name then
   if jsonb_typeof(p->field_name) is distinct from 'object' then raise exception 'FACT_OBJECT_REQUIRED'; end if;
   facts:=jsonb_set(facts,array[field_name],p->field_name);
  end if;
 end loop;
 activity:=facts->'activity'; identity:=facts->'identity';
 begin event_date:=(activity->>'event_date')::date;
 exception when invalid_datetime_format or datetime_field_overflow then event_date:=null; end;
 activity_ok:=coalesce(activity->>'status'='ACTIVE'
 and activity->>'basis' in ('RECENT_REVIEW','RECENT_PROJECT','RECENT_POST','RECENT_VACANCY','REGISTRY_ACTIVE','OWNER_CONFIRMED')
 and event_date between current_date-365 and current_date
 and lead_engine.sourced_route_evidence_ok(activity->'evidence'),false);
 identity_ok:=coalesce(identity->>'status'='CLEAR'
 and identity->'company_match_confirmed'='true'::jsonb
 and lead_engine.sourced_route_evidence_ok(identity->'evidence'),false);
 if activity->>'basis'='WEBSITE_BUSINESS_PRESENTATION' then
 activity_ok:=coalesce(activity->>'status'='ACTIVE'
 and activity->'services_present'='true'::jsonb
 and activity->'contact_consistent'='true'::jsonb
 and activity->'closure_indication'='false'::jsonb
 and lead_engine.sourced_route_evidence_ok(activity->'evidence'),false);
 end if;
 if activity_ok then update lead_engine.companies set active_status='ACTIVE',updated_at=now() where id=c.id;
 elsif p ? 'activity' then update lead_engine.companies set active_status='UNKNOWN',updated_at=now() where id=c.id; end if;
 if identity_ok and c.merged_into is null and c.identity_status<>'MERGED' then
  update lead_engine.companies set identity_status='CLEAR',updated_at=now() where id=c.id;
 else identity_ok:=false;
  if p ? 'identity' and c.identity_status<>'MERGED' then update lead_engine.companies set identity_status='REVIEW',updated_at=now() where id=c.id; end if;
 end if;
 if p ? 'route_id' then
  if not exists(select 1 from lead_engine.contact_routes where id=(p->>'route_id')::uuid and company_id=c.id) then raise exception 'CONTACT_COMPANY_MISMATCH'; end if;
  m.route_id:=(p->>'route_id')::uuid;
 end if;
 select * into r from lead_engine.contact_routes where id=m.route_id and company_id=c.id;
 update lead_engine.list_members set route_id=m.route_id where id=m.id;
 -- Accept canonical reviewed evidence in this same call; retain original evidence dates.
 if p ? 'assessment' then
  assessment:=p->'assessment';
  if assessment->'value'->>'policy_version_id' is distinct from versions->>'lead-intelligence-bible'
   or assessment->'value'->>'reviewer' is distinct from actor
   or coalesce(assessment->>'source_url','') !~ '^https?://'
   or (assessment->>'observed_at')::timestamptz is null
   then raise exception 'CURRENT_SOURCED_ASSESSMENT_REQUIRED'; end if;
  insert into lead_engine.observations(company_id,field,layer,value,source_url,observed_at,method)
  values(c.id,'website_outreach_assessment','DERIVED_FEATURE',assessment->'value',assessment->>'source_url',
    (assessment->>'observed_at')::timestamptz,'one-pass-qualification-v1');
 end if;
 select * into a from lead_engine.observations where company_id=c.id and field='website_outreach_assessment'
 order by observed_at desc,created_at desc,id desc limit 1;
 if not activity_ok then reasons:=array_append(reasons,'ACTIVITY_EVIDENCE_REQUIRED'); end if;
 if not identity_ok then reasons:=array_append(reasons,'IDENTITY_EVIDENCE_REQUIRED'); end if;
 if r.id is null or r.kind<>'EMAIL' or not r.enabled or r.is_inferred
 or coalesce(r.source_url,'') !~ '^https?://' or r.observed_at not between now()-interval '30 days' and now()+interval '5 minutes'
 or lower(r.value) ~ '@(example\.(com|org|net)|provider\.nl)$'
 then reasons:=array_append(reasons,'SOURCED_COMPANY_EMAIL_REQUIRED'); end if;
 -- Reuse production website/scope gates, deliberately excluding deliverability and dispatch gates.
 g:=lead_engine.gate_before_handoff(m.id);
 select reasons||coalesce(array_agg(v),'{}'::text[]) into reasons
 from jsonb_array_elements_text(g->'reasons') v
 where v in ('WEBSITE_OUTREACH_REASON_REQUIRED','CURRENT_WEBSITE_POLICY_REVIEW_REQUIRED','SCOPE_MISMATCH','LIST_NOT_ELIGIBLE','QUALITY_AUDIT_REVIEW_REQUIRED','QUALITY_AUDIT_BUSINESS_REJECTED');
 outcome:=case when cardinality(reasons)=0 then 'APPROVED' when actor='scripted-lead-research-v1' then 'NEEDS_EVIDENCE' else 'REJECTED' end;
 -- Rejection needs a reviewed, current negative verdict, not capture/network errors.
 if a.value->>'status'='INELIGIBLE' and a.layer='DERIVED_FEATURE'
 and a.value->>'policy_version_id'=versions->>'lead-intelligence-bible'
 and a.observed_at between now()-interval '30 days' and now()+interval '5 minutes'
 and a.value->'calibration_approved'='true'::jsonb
 and nullif(trim(a.value->>'reviewer'),'') is not null
 and nullif(trim(a.value->>'reason'),'') is not null
 and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(a.value->'evidence')='array' then a.value->'evidence' else '[]'::jsonb end) e
 where e->>'source_url' ~ '^https?://' and nullif(trim(e->>'screenshot_url'),'') is not null and nullif(trim(e->>'finding'),'') is not null)
 then outcome:='REJECTED'; reasons:=array['WEBSITE_DOES_NOT_MEET_CRITERIA']; end if;
 if p ? 'scope' then
  if p->'scope'->>'status' is distinct from 'INELIGIBLE' or p->'scope'->>'reason_code' is distinct from 'NOT_TARGET_BUSINESS'
   or not lead_engine.sourced_route_evidence_ok(p->'scope'->'evidence') then raise exception 'SOURCED_SCOPE_REJECTION_REQUIRED'; end if;
  outcome:='REJECTED'; reasons:=array['NOT_TARGET_BUSINESS'];
  facts:=jsonb_set(facts,array['scope'],p->'scope');
 end if;
 result:=jsonb_build_object('status',outcome,'missing_or_rejection_reasons',to_jsonb(reasons),
 'member_id',m.id,'company_id',c.id,'route_id',m.route_id,'assessment_id',a.id,
 'activity_confirmed',activity_ok,'identity_confirmed',identity_ok,
 'policy_versions',versions,'start_receipt_id',p->>'start_receipt_id',
 'contract','owner-single-screen-binary-v2','deliverability_stage','OUTREACH_ENGINE','outreach_authorized',false);
 update lead_engine.list_members set
 qualification=case when outcome='NEEDS_EVIDENCE' then 'PENDING' else outcome end,
 qualified_at=case when outcome='NEEDS_EVIDENCE' then null else now() end,
 qualified_by=actor,qualification_source=a.source_url,
 selection_snapshot=selection_snapshot||jsonb_build_object('qualification_facts',facts,'qualification_result',result)
 where id=m.id;
 insert into lead_engine.events(entity_type,entity_id,event_type,actor,details)
 values('list_member',m.id::text,'QUALIFICATION_COMPLETED',actor,result);
 return result;
end $function$
;
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
  if p_action='finish' and res->>'status'='APPROVED' then perform lead_engine.complete_saved_dossier(mid);end if;
  return res;
 end if;
 raise exception 'UNKNOWN_ACTION';
end $function$
;
