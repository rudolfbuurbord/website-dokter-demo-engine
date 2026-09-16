-- Additional operational commands; keep the base command implementation private.
alter function public.le_command(text,jsonb) rename to le_command_core;
alter function public.le_command_core(text,jsonb) set schema lead_engine;

create function lead_engine.select_route(cid uuid) returns uuid language sql stable security invoker set search_path='' as $$
 select r.id from lead_engine.contact_routes r left join lead_engine.contacts c on c.id=r.contact_id
 left join lateral (select verification_status,is_catch_all,checked_at from public.email_verifications v where v.normalized_email=r.value order by checked_at desc,id desc limit 1)v on true
 where r.company_id=cid and r.enabled and r.kind='EMAIL'
 and not exists(select 1 from public.email_suppressions s where s.status='active' and (lower(trim(s.email))=r.value or lower(trim(s.domain))=split_part(r.value,'@',2)))
 and not exists(select 1 from lead_engine.reservations x where x.company_id=cid and x.route_id=r.id and x.status='COMPLETED')
 order by case when v.verification_status='valid' and v.is_catch_all is not true and v.checked_at>=now()-make_interval(days=>(select value::text::int from lead_engine.settings where key='verification_max_age_days')) then 0 else 1 end,
 case c.role when 'OWNER' then 0 when 'DIRECTOR' then 0 when 'MANAGEMENT' then 1 when 'MARKETING' then 2 else 3 end,
 r.observed_at desc,r.id limit 1
$$;

create function lead_engine.build_list(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare l lead_engine.lists; run uuid; c record; route uuid; total int:=0; added int:=0; changed int; begin
 select * into l from lead_engine.lists where id=(p->>'list_id')::uuid for update;
 if not found or l.status not in ('DRAFT','BUILDING','QA') then raise exception 'DRAFT_OR_QA_LIST_REQUIRED'; end if;
 if exists(select 1 from jsonb_object_keys(l.selection_logic) k where k not in ('hypothesis','city','limit')) then raise exception 'UNSUPPORTED_SELECTION_FILTER'; end if;
 insert into lead_engine.build_runs(list_id,criteria_snapshot) values(l.id,jsonb_build_object('niche',l.niche,'country',l.country,'logic',l.selection_logic,'list_version',l.version)) returning id into run;
 update lead_engine.lists set status='BUILDING' where id=l.id;
 for c in select * from lead_engine.companies where niche=l.niche and country=l.country and active_status='ACTIVE' and identity_status='CLEAR'
 and (not l.selection_logic ? 'city' or lower(city)=lower(l.selection_logic->>'city'))
 order by created_at,id limit least(1000,greatest(1,coalesce((l.selection_logic->>'limit')::int,100))) loop
 total:=total+1; route:=lead_engine.select_route(c.id);
 insert into lead_engine.list_members(list_id,company_id,route_id,build_run_id,selection_reason,selection_snapshot)
 values(l.id,c.id,route,run,coalesce(l.selection_logic->>'hypothesis','Evidence-based niche/country selection'),jsonb_build_object('company',to_jsonb(c),'criteria',l.selection_logic,'list_version',l.version,'captured_at',now())) on conflict(list_id,company_id) do nothing;
 get diagnostics changed = ROW_COUNT; added:=added+changed;
 end loop;
 update lead_engine.build_runs set status='SUCCEEDED',counts=jsonb_build_object('eligible_candidates',total,'new_members',added,'existing_members',total-added),completed_at=now() where id=run;
 update lead_engine.lists set status='QA' where id=l.id;
 return jsonb_build_object('build_run_id',run,'candidates',total,'added',added,'status','QA');
end $$;

create function lead_engine.prepare_dispatch(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o lead_engine.outbox; r lead_engine.reservations; b lead_engine.batches; g jsonb; begin
 if (select value from lead_engine.settings where key='outreach_enabled') is distinct from 'true'::jsonb or not exists(select 1 from lead_engine.integrations where name='smartlead' and status='AVAILABLE') then
 return jsonb_build_object('allowed',false,'reasons',jsonb_build_array('OUTREACH_NOT_ENABLED_OR_PROVIDER_NOT_READY')); end if;
 select * into o from lead_engine.outbox where id=(p->>'outbox_id')::uuid for update;
 if not found or o.status<>'PENDING' then raise exception 'PENDING_OUTBOX_REQUIRED'; end if;
 select * into r from lead_engine.reservations where id=o.reservation_id for update;
 perform 1 from lead_engine.companies where id=r.company_id for update;
 select * into b from lead_engine.batches where id=r.batch_id for update;
 if b.status not in ('APPROVED','ACTIVE') or nullif(b.campaign_id,'') is null then raise exception 'ACTIVE_APPROVED_CAMPAIGN_REQUIRED'; end if;
 g:=lead_engine.gate(r.member_id,r.id);
 if r.status<>'RESERVED' then raise exception 'RESERVED_CONTACT_REQUIRED'; end if;
 if not (g->>'allowed')::boolean or g->>'email'<>r.email or (g->>'route_id')::uuid<>r.route_id then
 update lead_engine.reservations set status='BLOCKED',finished_at=now() where id=r.id;
 update lead_engine.outbox set status='CANCELLED',error='GATE_RECHECK_FAILED',updated_at=now() where id=o.id;
 return jsonb_build_object('allowed',false,'gate',g,'reason','GATE_RECHECK_FAILED'); end if;
 update lead_engine.reservations set status='DISPATCHING' where id=r.id;
 update lead_engine.outbox set status='DISPATCHING',updated_at=now() where id=o.id;
 -- No automatic retry after this boundary: acknowledgement or explicit reconciliation.
 return jsonb_build_object('allowed',true,'outbox_id',o.id,'idempotency_key',o.id,'payload',o.payload);
end $$;

create function lead_engine.complete_dispatch(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o lead_engine.outbox; r lead_engine.reservations; begin
 select * into o from lead_engine.outbox where id=(p->>'outbox_id')::uuid for update;
 if not found then raise exception 'OUTBOX_NOT_FOUND'; end if;
 if o.status='ACKNOWLEDGED' and o.external_id=p->>'external_id' then return jsonb_build_object('replayed',true); end if;
 if o.status not in ('DISPATCHING','RECONCILE') then raise exception 'DISPATCH_NOT_STARTED'; end if;
 select * into r from lead_engine.reservations where id=o.reservation_id for update;
 if p->>'outcome'='ACKNOWLEDGED' and nullif(p->>'external_id','') is not null then
 update lead_engine.outbox set status='ACKNOWLEDGED',external_id=p->>'external_id',updated_at=now() where id=o.id;
 if not exists(select 1 from lead_engine.company_blocks where company_id=r.company_id and active) then
 update lead_engine.reservations set status='ACTIVE' where id=r.id;
 else update lead_engine.reservations set status='RECONCILE' where id=r.id; end if;
 else
 update lead_engine.outbox set status='RECONCILE',error=left(p->>'error',1000),updated_at=now() where id=o.id;
 update lead_engine.reservations set status='RECONCILE' where id=r.id;
 insert into lead_engine.incidents(dedup_key,component,severity,summary,details) values('dispatch:'||o.id,'outreach','CRITICAL','External delivery uncertain; reconcile before retry',jsonb_build_object('outbox_id',o.id)) on conflict do nothing;
 end if;
 return jsonb_build_object('outbox_id',o.id,'status',(select status from lead_engine.outbox where id=o.id));
end $$;

create function lead_engine.demo_payload(cid uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c lead_engine.companies; facts jsonb; begin
 select * into c from lead_engine.companies where id=cid;
 if not found then raise exception 'COMPANY_NOT_FOUND'; end if;
 if not exists(select 1 from lead_engine.outcomes o join lead_engine.reservations r on r.id=o.reservation_id where r.company_id=cid and o.event_type='POSITIVE') then raise exception 'POSITIVE_INTEREST_REQUIRED'; end if;
 select coalesce(jsonb_object_agg(field,value),'{}') into facts from
 (select distinct on(field) field,value from lead_engine.observations where company_id=cid and layer in ('RAW_FACT','MANUAL_CORRECTION') order by field,case when layer='MANUAL_CORRECTION' then 0 else 1 end,observed_at desc,created_at desc,id desc)x;
 return jsonb_build_object('company_id',cid,'lead_status','HOT_LEAD','company_name',c.name,'niche',c.niche,'facts',facts,
 'provenance',(select jsonb_agg(jsonb_build_object('field',field,'source_url',source_url,'observed_at',observed_at,'observation_id',id)) from lead_engine.observations where company_id=cid),
 'publish_ready',false,'next_action','DEMO_RESEARCH_AND_QA_REQUIRED');
end $$;

create function public.le_command(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare cid uuid; mid uuid; r record; g jsonb; lid uuid; block_id uuid; begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKEND_ONLY' using errcode='42501'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'OBJECT_PAYLOAD_REQUIRED'; end if;
 case p_action
 when 'build_list' then return lead_engine.build_list(p_payload);
 when 'prepare_dispatch' then return lead_engine.prepare_dispatch(p_payload);
 when 'complete_dispatch' then return lead_engine.complete_dispatch(p_payload);
 when 'demo_payload' then return lead_engine.demo_payload((p_payload->>'company_id')::uuid);
 when 'pause_processing' then update lead_engine.settings set value='false',updated_at=now() where key='processing_enabled'; return '{"paused":true}';
 when 'resume_processing' then update lead_engine.settings set value='true',updated_at=now() where key='processing_enabled'; return '{"paused":false}';
 when 'correct_company' then
 cid:=(p_payload->>'company_id')::uuid;
 if nullif(p_payload->>'source_url','') is null or nullif(p_payload->>'reviewer','') is null or nullif(p_payload->>'reason','') is null then raise exception 'CORRECTION_EVIDENCE_AND_REASON_REQUIRED'; end if;
 perform 1 from lead_engine.companies where id=cid for update; if not found then raise exception 'COMPANY_NOT_FOUND'; end if;
 for r in select key,value from jsonb_each(p_payload->'fields') loop
 if r.key not in ('name','niche','country','city','active_status','identity_status') then raise exception 'UNSUPPORTED_CORRECTION_FIELD'; end if;
 execute format('update lead_engine.companies set %I=$1,updated_at=now() where id=$2',r.key) using r.value#>>'{}',cid;
 insert into lead_engine.observations(company_id,field,layer,value,source_url,observed_at,method) values(cid,r.key,'MANUAL_CORRECTION',r.value,p_payload->>'source_url',now(),'reviewer:'||(p_payload->>'reviewer')||'; reason:'||(p_payload->>'reason'));
 end loop;
 return jsonb_build_object('company_id',cid,'corrected',true);
 when 'select_route' then
 mid:=(p_payload->>'member_id')::uuid;
 select * into r from lead_engine.list_members where id=mid for update; if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
 if exists(select 1 from lead_engine.reservations where member_id=mid and status in ('RESERVED','DISPATCHING','ACTIVE','RECONCILE')) then raise exception 'CONTACT_RESERVED'; end if;
 update lead_engine.list_members set route_id=lead_engine.select_route(r.company_id),qualification='PENDING',qualified_at=null where id=mid;
 return jsonb_build_object('member_id',mid,'route_id',(select route_id from lead_engine.list_members where id=mid));
 when 'ready_list' then
 lid:=(p_payload->>'list_id')::uuid; perform 1 from lead_engine.lists where id=lid and status='QA' for update;
 if not found then raise exception 'QA_LIST_REQUIRED'; end if;
 if not exists(select 1 from lead_engine.list_members where list_id=lid and (lead_engine.gate(id)->>'allowed')::boolean) then raise exception 'NO_READY_MEMBERS'; end if;
 update lead_engine.lists set status='READY' where id=lid;
 return jsonb_build_object('list_id',lid,'status','READY','note','Only individually gated members may be reserved');
 when 'block_company' then
 cid:=(p_payload->>'company_id')::uuid;
 if nullif(p_payload->>'reason','') is null or nullif(p_payload->>'source_ref','') is null then raise exception 'BLOCK_REASON_REQUIRED'; end if;
 perform 1 from lead_engine.companies where id=cid for update;
 insert into lead_engine.company_blocks(company_id,reason,source_ref) values(cid,p_payload->>'reason',p_payload->>'source_ref') on conflict(company_id,reason) do update set active=true returning id into block_id;
 update lead_engine.outbox set status='CANCELLED',updated_at=now() where status='PENDING' and reservation_id in(select id from lead_engine.reservations where company_id=cid);
 update lead_engine.reservations set status='BLOCKED',finished_at=now() where company_id=cid and status='RESERVED';
 if exists(select 1 from lead_engine.reservations where company_id=cid and status in ('DISPATCHING','ACTIVE','RECONCILE')) then
 insert into lead_engine.incidents(dedup_key,component,severity,summary,details) values('block:'||block_id,'outreach','CRITICAL','External stop confirmation required',jsonb_build_object('company_id',cid)) on conflict do nothing; end if;
 return jsonb_build_object('blocked',true,'company_id',cid);
 when 'retry_job' then
 if nullif(p_payload->>'reason','') is null then raise exception 'RETRY_REASON_REQUIRED'; end if;
 update lead_engine.jobs set status='QUEUED',attempt_count=0,run_after=now(),max_attempts=least(10,max_attempts),error_code=null,error_detail=null,updated_at=now()
 where id=(p_payload->>'job_id')::uuid and status in ('FAILED','BLOCKED') and not exists(select 1 from lead_engine.job_attempts where job_id=(p_payload->>'job_id')::uuid);
 -- Historical attempts must never be overwritten: requeue with a new idempotency key instead.
 if not found then raise exception 'CREATE_NEW_JOB_WITH_RECOVERY_KEY_TO_PRESERVE_ATTEMPTS'; end if;
 return jsonb_build_object('queued',true);
 else return lead_engine.le_command_core(p_action,p_payload);
 end case;
end $$;
revoke execute on all functions in schema lead_engine from public,anon,authenticated;
grant execute on all functions in schema lead_engine to service_role;
revoke execute on function public.le_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.le_command(text,jsonb) to service_role;
notify pgrst,'reload schema';
