
-- Approved nonvisual lead routes; never infer a broken public website from capture failures.
create or replace function lead_engine.sourced_route_evidence_ok(items jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare e jsonb; d timestamptz;
begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)=0 then return false; end if;
 for e in select value from jsonb_array_elements(items) loop
  if coalesce(e->>'source_url','') !~ '^https?://' or nullif(trim(e->>'finding'),'') is null then return false; end if;
  d:=(e->>'observed_at')::timestamptz;
  if d is null or d not between now()-interval '30 days' and now()+interval '5 minutes' then return false; end if;
 end loop;
 return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;

create or replace function lead_engine.nonvisual_route_ok(v jsonb, cid uuid, rid uuid)
returns boolean language plpgsql stable set search_path='' as $$
declare route lead_engine.contact_routes; c lead_engine.companies; reason text:=v->>'reason_code';
begin
 if reason is null or reason not in ('NO_WEBSITE_FOUND','WEBSITE_UNREACHABLE')
 or v->>'status' is distinct from 'ELIGIBLE'
 or nullif(trim(v->>'reviewer'),'') is null or nullif(trim(v->>'reason'),'') is null
 or v->'activity_confirmed' is distinct from 'true'::jsonb
 or v->'identity_confirmed' is distinct from 'true'::jsonb
 or not lead_engine.sourced_route_evidence_ok(v->'activity_evidence')
 or not lead_engine.sourced_route_evidence_ok(v->'identity_evidence')
 then return false; end if;
 select * into c from lead_engine.companies where id=cid;
 if c.active_status is distinct from 'ACTIVE' or c.identity_status is distinct from 'CLEAR' then return false; end if;
 select * into route from lead_engine.contact_routes where id=rid and company_id=cid;
 if route.kind is distinct from 'EMAIL' or route.enabled is distinct from true
 or route.is_inferred is distinct from false or coalesce(route.source_url,'') !~ '^https?://'
 or route.observed_at is null or route.observed_at>now()+interval '5 minutes'
 or v->>'contact_route_id' is distinct from rid::text
 or lower(coalesce(route.value,'')) ~ '@(example\.(com|org|net)|provider\.nl)$' then return false; end if;
 if reason='NO_WEBSITE_FOUND' then
  return coalesce(v->'no_website_found'='true'::jsonb,false)
   and lead_engine.sourced_route_evidence_ok(v->'website_search_evidence');
 end if;
 return coalesce(v->>'independent_check_status'='UNREACHABLE',false)
  and lead_engine.sourced_route_evidence_ok(v->'reachability_evidence')
  and coalesce(v->'public_defect_claimed'='false'::jsonb,false);
end $$;
revoke all on function lead_engine.sourced_route_evidence_ok(jsonb) from public,anon,authenticated;
revoke all on function lead_engine.nonvisual_route_ok(jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function lead_engine.sourced_route_evidence_ok(jsonb),lead_engine.nonvisual_route_ok(jsonb,uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION lead_engine.gate_before_handoff(member uuid, own_reservation uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m record; v record; reasons text[]:='{}'; age_days int; begin
 select lm.*,c.niche as company_niche,c.country,c.active_status,c.identity_status,c.domain,l.niche as list_niche,l.status as list_status,
 r.value as email,r.kind,r.enabled,r.source_url as route_source
 into m from lead_engine.list_members lm join lead_engine.companies c on c.id=lm.company_id join lead_engine.lists l on l.id=lm.list_id
 left join lead_engine.contact_routes r on r.id=lm.route_id and r.company_id=lm.company_id where lm.id=member;
 if not found then return jsonb_build_object('allowed',false,'reasons',jsonb_build_array('MEMBER_NOT_FOUND')); end if;
 if m.active_status<>'ACTIVE' then reasons:=array_append(reasons,'COMPANY_NOT_CONFIRMED_ACTIVE'); end if;
 if m.identity_status<>'CLEAR' then reasons:=array_append(reasons,'IDENTITY_REVIEW'); end if;
 if m.country is distinct from 'NL' or m.company_niche is distinct from m.list_niche then reasons:=array_append(reasons,'SCOPE_MISMATCH'); end if;
 if m.list_status in ('ARCHIVED','EXHAUSTED') then reasons:=array_append(reasons,'LIST_NOT_ELIGIBLE'); end if;

 declare a record; reason_ok boolean:=false;
 begin
 select * into a from lead_engine.observations
 where company_id=m.company_id and field='website_outreach_assessment'
 order by observed_at desc,created_at desc,id desc limit 1;
 if found then
 reason_ok:=coalesce(
 a.layer='DERIVED_FEATURE'
 and a.observed_at between now()-interval '30 days' and now()+interval '5 minutes'
 and a.source_url ~ '^https?://'
 and a.value->>'status'='ELIGIBLE'
 and a.value->>'reason_code' in ('BROKEN_WEBSITE','OUTDATED_WEBSITE','POOR_VISUAL_QUALITY')
 and length(trim(a.value->>'reviewer'))>0
 and length(trim(a.value->>'reason'))>0
 and jsonb_typeof(a.value->'evidence')='array'
 and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(a.value->'evidence')='array' then a.value->'evidence' else '[]'::jsonb end) e where length(trim(e->>'finding'))>0 and e->>'source_url' ~ '^https?://' and (a.value->>'reason_code'='BROKEN_WEBSITE' or length(trim(e->>'screenshot_url'))>0))
 and (case when a.value->>'reason_code'='BROKEN_WEBSITE' then a.value->'rechecked_in_browser'='true'::jsonb
 else a.value->'calibration_approved'='true'::jsonb and length(trim(a.value->>'rubric_version'))>0 end),false);
 reason_ok:=reason_ok or coalesce(
 a.layer='DERIVED_FEATURE'
 and a.observed_at between now()-interval '30 days' and now()+interval '5 minutes'
 and a.source_url ~ '^https?://'
 and lead_engine.nonvisual_route_ok(a.value,m.company_id,m.route_id),false);
 end if;
 if not reason_ok then reasons:=array_append(reasons,'WEBSITE_OUTREACH_REASON_REQUIRED'); end if;
 end;

 if not exists(
 select 1 from (select value from lead_engine.observations where company_id=m.company_id and field='website_outreach_assessment' order by observed_at desc,created_at desc,id desc limit 1) a
 join public.bibles b on b.slug='lead-intelligence-bible'
 join public.bible_versions policy_v on policy_v.bible_id=b.id and policy_v.version=b.current_version
 where a.value->>'policy_version_id'=policy_v.id::text
 ) then reasons:=array_append(reasons,'CURRENT_WEBSITE_POLICY_REVIEW_REQUIRED');end if;
 if m.qualification<>'APPROVED' then reasons:=array_append(reasons,'QUALIFICATION_REQUIRED'); end if;
 select (value::text)::int into age_days from lead_engine.settings where key='qualification_max_age_days';
 if m.qualified_at is null or m.qualified_at<now()-make_interval(days=>age_days) then reasons:=array_append(reasons,'QUALIFICATION_STALE'); end if;
 if m.kind is distinct from 'EMAIL' or m.enabled is distinct from true or nullif(m.route_source,'') is null then reasons:=array_append(reasons,'CONTACT_ROUTE_REQUIRED'); end if;
 select * into v from public.email_verifications where normalized_email=m.email order by checked_at desc,id desc limit 1;
 select (value::text)::int into age_days from lead_engine.settings where key='verification_max_age_days';
 if v.verification_status is distinct from 'valid' or v.is_catch_all is true or nullif(v.verifier,'') is null then reasons:=array_append(reasons,'EMAIL_NOT_VERIFIED_VALID');
 elsif v.checked_at>now()+interval '5 minutes' or v.checked_at<now()-make_interval(days=>age_days) then reasons:=array_append(reasons,'VERIFICATION_STALE'); end if;
 if exists(select 1 from public.email_suppressions where status='active' and (lower(trim(email))=m.email or (domain is not null and lower(trim(domain)) in (m.domain,split_part(m.email,'@',2))))) then reasons:=array_append(reasons,'EMAIL_SUPPRESSED'); end if;
 if exists(select 1 from lead_engine.company_blocks where company_id=m.company_id and active) then reasons:=array_append(reasons,'COMPANY_BLOCKED'); end if;
 if exists(select 1 from lead_engine.reservations where (company_id=m.company_id or email=m.email) and status in ('RESERVED','DISPATCHING','ACTIVE','RECONCILE') and (own_reservation is null or id<>own_reservation)) then reasons:=array_append(reasons,'ACTIVE_OUTREACH_CONFLICT'); end if;
 if exists(select 1 from lead_engine.reservations where company_id=m.company_id and route_id=m.route_id and status='COMPLETED') then reasons:=array_append(reasons,'CONTACT_ALREADY_COMPLETED'); end if;
 return jsonb_build_object('allowed',cardinality(reasons)=0,'reasons',to_jsonb(reasons),'member_id',member,'company_id',m.company_id,'route_id',m.route_id,'email',m.email,'verification_id',v.id,'checked_at',now());
end $function$
;
CREATE OR REPLACE FUNCTION lead_engine.email_dossier(p_member uuid, p_own_reservation uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare lm lead_engine.list_members; comp lead_engine.companies; li lead_engine.lists;
 a lead_engine.observations; t lead_engine.observations; route lead_engine.contact_routes;
 nonvisual boolean:=false; reasons jsonb; checks jsonb; k text; it jsonb; dossier jsonb;
begin
 select * into lm from lead_engine.list_members where id=p_member;
 if not found then return jsonb_build_object('allowed',false,'reasons',jsonb_build_array('MEMBER_NOT_FOUND')); end if;
 select coalesce(jsonb_agg(rr),'[]') into reasons from jsonb_array_elements_text(lead_engine.gate_before_handoff(p_member,p_own_reservation)->'reasons') rr
 where rr not in ('EMAIL_NOT_VERIFIED_VALID','VERIFICATION_STALE');
 select * into comp from lead_engine.companies where id=lm.company_id;
 select * into li from lead_engine.lists where id=lm.list_id;
 select * into route from lead_engine.contact_routes where id=lm.route_id and company_id=lm.company_id;
 if route.is_inferred is distinct from false or route.source_url !~ '^https?://' or route.value is null or route.observed_at is null then reasons:=reasons||jsonb_build_array('SOURCED_CONTACT_REQUIRED');end if;
 if nullif(trim(lm.selection_reason),'') is null then reasons:=reasons||jsonb_build_array('SELECTION_REASON_REQUIRED');end if;
 if not exists(select 1 from lead_engine.source_records sr where sr.company_id=lm.company_id and sr.source_url ~ '^https?://') then reasons:=reasons||jsonb_build_array('SOURCE_PROVENANCE_REQUIRED');end if;
 select * into a from lead_engine.observations where company_id=lm.company_id and field='website_outreach_assessment' order by observed_at desc,created_at desc,id desc limit 1;
 nonvisual:=lead_engine.nonvisual_route_ok(a.value,lm.company_id,lm.route_id);
 if not nonvisual then
 if nullif(trim(a.value->>'holistic_impression'),'') is null or a.value->'desktop_reviewed' is distinct from 'true'::jsonb
 or coalesce(a.value->>'mobile_review_status','') not in ('REVIEWED','UNKNOWN','NOT_TESTED')
 or jsonb_typeof(a.value->'reviewed_urls') is distinct from 'array' then
 reasons:=reasons||jsonb_build_array('VISUAL_SCOPE_REQUIRED');
 elsif jsonb_array_length(a.value->'reviewed_urls')=0 or exists(select 1 from jsonb_array_elements_text(a.value->'reviewed_urls') u where u !~ '^https?://') then
 reasons:=reasons||jsonb_build_array('REVIEWED_URLS_REQUIRED'); end if;
 if jsonb_typeof(a.value->'strengths') is distinct from 'array' or jsonb_typeof(a.value->'unknowns') is distinct from 'array' then reasons:=reasons||jsonb_build_array('STRENGTHS_AND_UNKNOWNS_REQUIRED');
 else
 for it in select value from jsonb_array_elements(a.value->'strengths') loop
 if nullif(trim(it->>'finding'),'') is null or coalesce(it->>'source_url','') !~ '^https?://' or nullif(trim(it->>'observed_at'),'') is null then
 reasons:=reasons||jsonb_build_array('UNSOURCED_STRENGTH');exit;end if;
 end loop;end if;
 if jsonb_typeof(a.value->'evidence')='array' then
 for it in select value from jsonb_array_elements(a.value->'evidence') loop
 if nullif(trim(it->>'finding'),'') is null or coalesce(it->>'source_url','') !~ '^https?://' or
 (a.value->>'reason_code'<>'BROKEN_WEBSITE' and nullif(trim(it->>'screenshot_url'),'') is null) then
 reasons:=reasons||jsonb_build_array('INCOMPLETE_VISUAL_EVIDENCE');exit;end if;
 end loop;end if;
 end if;
 select * into t from lead_engine.observations where company_id=lm.company_id and field='website_technical_review' order by observed_at desc,created_at desc,id desc limit 1;
 if t.id is null or t.layer<>'RAW_FACT' or t.observed_at not between now()-interval '30 days' and now()+interval '5 minutes'
 or coalesce(t.source_url,'') !~ '^https?://' or nullif(trim(t.value->>'reviewer'),'') is null or nullif(trim(t.value->>'scope'),'') is null
 or jsonb_typeof(t.value->'checks') is distinct from 'object' or jsonb_typeof(t.value->'findings') is distinct from 'array' or jsonb_typeof(t.value->'limitations') is distinct from 'array' then
 reasons:=reasons||jsonb_build_array('TECHNICAL_REVIEW_REQUIRED');
 else
 checks:=t.value->'checks';
 foreach k in array array['reachability','navigation','assets','mobile','contact_flow','forms','basics'] loop
 if coalesce(checks->>k,'') not in ('CHECKED_NO_ISSUE_FOUND','CONFIRMED_ISSUE','UNKNOWN','NOT_TESTED') then reasons:=reasons||jsonb_build_array('TECHNICAL_SCOPE_'||k); end if;
 if checks->>k='CONFIRMED_ISSUE' and not exists(select 1 from jsonb_array_elements(t.value->'findings') f where f->>'category'=k) then reasons:=reasons||jsonb_build_array('TECHNICAL_EVIDENCE_'||k);end if;
 end loop;
 for it in select value from jsonb_array_elements(t.value->'findings') loop
 if coalesce(checks->>(it->>'category'),'')<>'CONFIRMED_ISSUE' or nullif(trim(it->>'finding'),'') is null or coalesce(it->>'source_url','') !~ '^https?://'
 or nullif(trim(it->>'observed_at'),'') is null or nullif(trim(it->>'evidence_url'),'') is null or it->'rechecked_in_browser' is distinct from 'true'::jsonb then
 reasons:=reasons||jsonb_build_array('UNCONFIRMED_TECHNICAL_FINDING');exit;end if;
 end loop;
 end if;
 dossier:=jsonb_build_object('contract_version','lead-email-v1','policy_versions',lead_engine.handoff_versions(),
 'company',to_jsonb(comp)-'updated_at','membership',to_jsonb(lm),'list',to_jsonb(li)-'status',
 'lead_route',a.value->>'reason_code',
 'demo_route',case when a.value->>'reason_code'='NO_WEBSITE_FOUND' then 'STANDARD_NICHE_NAME_LOGO'
 when a.value->>'reason_code'='WEBSITE_UNREACHABLE' then 'STANDARD_NICHE_VERIFIED_FACTS'
 else 'WEBSITE_REDESIGN' end,
 'selected_route',to_jsonb(route),'visual_assessment',to_jsonb(a),'technical_review',to_jsonb(t),
 'sources',coalesce((select jsonb_agg(to_jsonb(sr) order by sr.id) from lead_engine.source_records sr where sr.company_id=lm.company_id),'[]'),
 'contacts',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from lead_engine.contacts c where c.company_id=lm.company_id),'[]'),
 'observations',coalesce((select jsonb_agg(to_jsonb(o) order by o.id) from lead_engine.observations o where o.company_id=lm.company_id),'[]'));
 return jsonb_build_object('allowed',jsonb_array_length(reasons)=0,'reasons',reasons,'snapshot',dossier,'fingerprint',md5(dossier::text));
end $function$
;

create or replace function lead_engine.research_followup_route(error_text text)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object(
 'state','NEEDS_EVIDENCE','auto_qualified',false,'automatic_paid_retries',0,'maximum_independent_rechecks',1,
 'next_action',case
 when error_text='WEBSITE_UNKNOWN' then 'ACTIVITY_EMAIL_AND_WEBSITE_SEARCH'
 when error_text like '%INVALID_EVIDENCE%' or error_text like '%MODEL_%' or error_text='INCOMPLETE_MODEL_RESULT' then 'REUSE_EXISTING_EVIDENCE'
 when error_text like '%REDIRECT%' then 'IDENTITY_AND_DESTINATION_REVIEW'
 when error_text is not null then 'BOUNDED_REACHABILITY_ACTIVITY_EMAIL_REVIEW'
 else 'REVIEW_EXISTING_CAPTURE' end);
$$;
revoke all on function lead_engine.research_followup_route(text) from public,anon,authenticated;
grant execute on function lead_engine.research_followup_route(text) to service_role;

CREATE OR REPLACE FUNCTION public.le_research(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r lead_engine.research_runs; t lead_engine.research_tasks; s lead_engine.research_spend; versions jsonb; result jsonb; n int;
begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKEND_ONLY'; end if;
 if p_action='status' then
  return jsonb_build_object('runs',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (
   select runrow.*, (select count(*) from lead_engine.research_tasks taskrow where taskrow.run_id=runrow.id) tasks,
   (select count(*) from lead_engine.research_tasks taskrow where taskrow.run_id=runrow.id and taskrow.status='REVIEW') reviewed,
   (select count(*) from lead_engine.research_tasks taskrow where taskrow.run_id=runrow.id and taskrow.status='ERROR') errors,
   (select coalesce(sum(coalesce(spendrow.actual_usd,spendrow.reserved_usd)),0) from lead_engine.research_spend spendrow where spendrow.run_id=runrow.id) committed_usd
   from lead_engine.research_runs runrow order by created_at desc limit 10) q));
 end if;
 select jsonb_object_agg(b.slug,v.id::text) into versions from public.bibles b join public.bible_versions v on v.bible_id=b.id and v.version=b.current_version where b.slug in ('lead-intelligence-bible','schilders-niche-bible','lead-engine-chat-context','cold-email-bible');
 if not exists(select 1 from lead_engine.events e where e.id::text=p_payload->>'start_receipt_id' and e.event_type='BIBLE_START_RECEIPT' and e.created_at>now()-interval '24 hours' and e.details->'versions'=versions) then raise exception 'CURRENT_BIBLE_START_REQUIRED'; end if;
 if p_action='seed' then
  if nullif(p_payload->>'run_key','') is null then raise exception 'RUN_KEY_REQUIRED'; end if;
  insert into lead_engine.research_runs(list_id,run_key) values((p_payload->>'list_id')::uuid,p_payload->>'run_key') on conflict(run_key) do nothing;
  select * into r from lead_engine.research_runs where run_key=p_payload->>'run_key' for update;
  if r.list_id<>(p_payload->>'list_id')::uuid then raise exception 'RUN_KEY_CONFLICT'; end if;
  insert into lead_engine.research_tasks(run_id,company_id,member_id)
  select r.id,m.company_id,m.id from lead_engine.list_members m join lead_engine.companies c on c.id=m.company_id where m.list_id=r.list_id order by c.name,m.id limit least(greatest(coalesce((p_payload->>'limit')::int,20),1),1000)
  on conflict(run_id,company_id) do nothing;
  return to_jsonb(r);
 elsif p_action='claim' then
  select * into r from lead_engine.research_runs where id=(p_payload->>'run_id')::uuid for update;
  if not found then raise exception 'RUN_NOT_FOUND'; end if;
  if r.status<>'ACTIVE' then return jsonb_build_object('status',r.status); end if;
  -- Crashed attempts with any uncertain paid request are never automatically retried.
  update lead_engine.research_tasks j set status=case when j.attempts>=2 or exists(select 1 from lead_engine.research_spend spent where spent.task_id=j.id) then 'ERROR' else 'QUEUED' end,error_code='LEASE_EXPIRED',updated_at=now()
   where j.run_id=r.id and j.status='RUNNING' and j.lease_until<now();
  select * into t from lead_engine.research_tasks where run_id=r.id and status='QUEUED' order by updated_at,id for update skip locked limit 1;
  if not found then return jsonb_build_object('status','IDLE'); end if;
  update lead_engine.research_tasks set status='RUNNING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',policy_versions=versions,start_receipt_id=p_payload->>'start_receipt_id',updated_at=now() where id=t.id returning * into t;
  return to_jsonb(t)||jsonb_build_object('company',(select to_jsonb(c) from lead_engine.companies c where c.id=t.company_id));
 elsif p_action in ('reserve','settle','finish') then
  -- Use run -> task lock order consistently with claim to avoid deadlocks.
  select * into r from lead_engine.research_runs where id=(select run_id from lead_engine.research_tasks where id=(p_payload->>'task_id')::uuid) for update;
  select * into t from lead_engine.research_tasks where id=(p_payload->>'task_id')::uuid for update;
  if not found or t.lease_token is distinct from (p_payload->>'lease_token')::uuid then raise exception 'LEASE_MISMATCH'; end if;
  if p_action='settle' then
   select * into s from lead_engine.research_spend where task_id=t.id and lease_token=t.lease_token for update;
   if not found then raise exception 'RESERVATION_REQUIRED'; end if;
   if s.actual_usd is not null then
    if s.provider_request_id is distinct from p_payload->>'provider_request_id' or s.actual_usd is distinct from (p_payload->>'actual_usd')::numeric then raise exception 'SETTLEMENT_CONFLICT'; end if;
    return to_jsonb(s);
   end if;
   if nullif(p_payload->>'provider_request_id','') is null then raise exception 'PROVIDER_RECEIPT_REQUIRED'; end if;
   update lead_engine.research_spend set actual_usd=(p_payload->>'actual_usd')::numeric,provider_request_id=p_payload->>'provider_request_id',usage=p_payload->'usage' where id=s.id returning * into s;
   if s.actual_usd>s.reserved_usd then update lead_engine.research_runs set status='PAUSED' where id=t.run_id; end if;
   return to_jsonb(s);
  end if;
  if t.policy_versions<>versions then raise exception 'POLICY_CHANGED'; end if;
  if p_action='finish' and t.status in ('REVIEW','ERROR') then
   if t.output is distinct from p_payload->'output' then raise exception 'FINISH_CONFLICT'; end if;
   return to_jsonb(t);
  end if;
  if t.status<>'RUNNING' or t.lease_until<now() then raise exception 'LEASE_EXPIRED'; end if;
  if p_action='reserve' then
   select * into r from lead_engine.research_runs where id=t.run_id for update;
   if r.status<>'ACTIVE' then raise exception 'RUN_PAUSED'; end if;
   if exists(select 1 from lead_engine.research_spend where task_id=t.id and lease_token=t.lease_token) then raise exception 'ALREADY_RESERVED_NO_RESUBMIT'; end if;
   if (p_payload->>'amount_usd')::numeric is null or (p_payload->>'amount_usd')::numeric<=0 then raise exception 'POSITIVE_RESERVATION_REQUIRED'; end if;
   if (select coalesce(sum(coalesce(actual_usd,reserved_usd)),0) from lead_engine.research_spend where run_id=r.id)+(p_payload->>'amount_usd')::numeric>r.budget_usd then raise exception 'BUDGET_EXHAUSTED'; end if;
   insert into lead_engine.research_spend(run_id,task_id,lease_token,reserved_usd) values(r.id,t.id,t.lease_token,(p_payload->>'amount_usd')::numeric) returning * into s;
   return to_jsonb(s);
  end if;
  if p_payload->'output' is null or jsonb_typeof(p_payload->'output')<>'object' then raise exception 'OUTPUT_REQUIRED'; end if;
  update lead_engine.research_tasks set status=case when p_payload->>'error_code' is null then 'REVIEW' else 'ERROR' end, output=p_payload->'output',error_code=p_payload->>'error_code',updated_at=now() where id=t.id returning * into t;
  -- Pilot proposals deliberately cannot satisfy the production website gate.
  if nullif(t.output->>'source_url','') is not null then
  insert into lead_engine.observations(company_id,field,layer,value,source_url,observed_at,confidence,method)
  values(t.company_id,'website_research_proposal','DERIVED_FEATURE',t.output||jsonb_build_object('research_task_id',t.id,'policy_versions',t.policy_versions,'start_receipt_id',t.start_receipt_id),t.output->>'source_url',now(),null,'scripted-research-v1-pilot');
  end if;
  insert into lead_engine.observations(company_id,field,layer,value,source_url,observed_at,method)
  values(t.company_id,'research_followup_route','DERIVED_FEATURE',
    lead_engine.research_followup_route(t.error_code)||jsonb_build_object('research_task_id',t.id,'policy_versions',t.policy_versions),
    coalesce(nullif(t.output->>'source_url',''),'https://supabase.com/dashboard/project/skdjbifmtleiogbkqwid'),
    now(),'bounded-routing-v1');
  return to_jsonb(t);
 end if;
 raise exception 'UNKNOWN_ACTION';
end $function$
;
