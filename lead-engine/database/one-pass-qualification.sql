-- One research submission writes the dossier and final membership decision atomically.
-- Website capture/model proposals remain intermediate evidence, never approval by themselves.
create or replace function lead_engine.complete_qualification(p jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
 where v in ('WEBSITE_OUTREACH_REASON_REQUIRED','CURRENT_WEBSITE_POLICY_REVIEW_REQUIRED','SCOPE_MISMATCH','LIST_NOT_ELIGIBLE');
 outcome:=case when cardinality(reasons)=0 then 'APPROVED' else 'NEEDS_EVIDENCE' end;
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
 result:=jsonb_build_object('status',outcome,'missing_or_rejection_reasons',to_jsonb(reasons),
 'member_id',m.id,'company_id',c.id,'route_id',m.route_id,'assessment_id',a.id,
 'activity_confirmed',activity_ok,'identity_confirmed',identity_ok,
 'policy_versions',versions,'start_receipt_id',p->>'start_receipt_id',
 'contract','one-pass-qualification-v1','deliverability_stage','OUTREACH_ENGINE','outreach_authorized',false);
 update lead_engine.list_members set
 qualification=case when outcome='NEEDS_EVIDENCE' then 'PENDING' else outcome end,
 qualified_at=case when outcome='NEEDS_EVIDENCE' then null else now() end,
 qualified_by=actor,qualification_source=a.source_url,
 selection_snapshot=selection_snapshot||jsonb_build_object('qualification_facts',facts,'qualification_result',result)
 where id=m.id;
 insert into lead_engine.events(entity_type,entity_id,event_type,actor,details)
 values('list_member',m.id::text,'QUALIFICATION_COMPLETED',actor,result);
 return result;
end $$;
revoke all on function lead_engine.complete_qualification(jsonb) from public,anon,authenticated;
grant execute on function lead_engine.complete_qualification(jsonb) to service_role;

-- Existing Hetzner finish calls receive the final qualification stage without an image rebuild.
create or replace function lead_engine.research_qualification_stage()
returns trigger language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if new.status in ('REVIEW','ERROR') and old.status is distinct from new.status and new.member_id is not null then
  begin
   result:=lead_engine.complete_qualification(jsonb_build_object('member_id',new.member_id,
    'start_receipt_id',new.start_receipt_id,'reviewer','scripted-lead-research-v1'));
  exception when others then
   -- Preserve the capture and its raw error even if finalization cannot commit.
   result:=jsonb_build_object('status','NEEDS_EVIDENCE','missing_or_rejection_reasons',
    jsonb_build_array('QUALIFICATION_FINALIZATION_FAILED'),'contract','one-pass-qualification-v1');
  end;
  new.output:=coalesce(new.output,'{}'::jsonb)||jsonb_build_object('qualification_result',result);
 end if;
 return new;
end $$;
revoke all on function lead_engine.research_qualification_stage() from public,anon,authenticated;
grant execute on function lead_engine.research_qualification_stage() to service_role;
create trigger research_qualification_stage before update of status on lead_engine.research_tasks
for each row execute function lead_engine.research_qualification_stage();

insert into lead_engine.settings(key,value) values('qualification_workflow',
 '{"contract":"one-pass-qualification-v1","command":"complete_qualification","required":["website_suitability","activity","identity","sourced_email"],"outcomes":["APPROVED","REJECTED","NEEDS_EVIDENCE"],"external_research_rounds":1,"independent_network_rechecks":1,"paid_error_retries":0,"deliverability_stage":"OUTREACH_ENGINE","external_research_executor":"CODEX_SESSION","capture_is_intermediate":true}')
on conflict(key) do update set value=excluded.value,updated_at=now();
