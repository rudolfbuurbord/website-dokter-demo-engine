create table lead_engine.cost_entries (
 id uuid primary key default gen_random_uuid(), idempotency_key text not null unique,
 company_id uuid references lead_engine.companies, source_id uuid references lead_engine.sources,
 job_id uuid references lead_engine.jobs, build_run_id uuid references lead_engine.build_runs,
 category text not null check(category in ('SOURCING','ENRICHMENT','VERIFICATION','WEBSITE_AUDIT','OUTREACH')),
 amount_eur numeric(12,6) not null check(amount_eur>=0), evidence_ref text not null,
 incurred_at timestamptz not null default now()
);
create index le_cost_company on lead_engine.cost_entries(company_id);
create index le_cost_source on lead_engine.cost_entries(source_id);
create index le_cost_job on lead_engine.cost_entries(job_id);
create index le_cost_run on lead_engine.cost_entries(build_run_id);
alter table lead_engine.cost_entries enable row level security;
revoke all on lead_engine.cost_entries from public,anon,authenticated;
grant select,insert on lead_engine.cost_entries to service_role;

create table lead_engine.crm_handoffs (
 reservation_id uuid primary key references lead_engine.reservations,
 company_id uuid not null references lead_engine.companies,
 opportunity_id uuid not null references public.crm_opportunities,
 created_at timestamptz not null default now()
);
create index le_handoff_company on lead_engine.crm_handoffs(company_id);
create index le_handoff_opportunity on lead_engine.crm_handoffs(opportunity_id);
alter table lead_engine.crm_handoffs enable row level security;
revoke all on lead_engine.crm_handoffs from public,anon,authenticated;
grant select,insert on lead_engine.crm_handoffs to service_role;

create function lead_engine.crm_handoff(reservation uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare r lead_engine.reservations; c lead_engine.companies; b lead_engine.batches; oid uuid; phone text; named text; begin
 select * into r from lead_engine.reservations where id=reservation for update;
 if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
 if not exists(select 1 from lead_engine.outcomes where reservation_id=r.id and event_type='POSITIVE') then raise exception 'POSITIVE_INTEREST_REQUIRED'; end if;
 select opportunity_id into oid from lead_engine.crm_handoffs where reservation_id=r.id;
 if oid is not null then return oid; end if;
 select * into c from lead_engine.companies where id=r.company_id;
 select * into b from lead_engine.batches where id=r.batch_id;
 select value into phone from lead_engine.contact_routes where company_id=c.id and kind='PHONE' and enabled order by observed_at desc limit 1;
 select ct.name into named from lead_engine.contact_routes cr join lead_engine.contacts ct on ct.id=cr.contact_id where cr.id=r.route_id;
 if (select count(*) from public.crm_opportunities where contact_email=r.email and campaign_id=b.campaign_id)>1 then raise exception 'AMBIGUOUS_EXISTING_CRM_OPPORTUNITIES'; end if;
 select id into oid from public.crm_opportunities where contact_email=r.email and campaign_id=b.campaign_id limit 1;
 if oid is null then
 insert into public.crm_opportunities(company_name,contact_name,contact_email,contact_phone,niche,status,source,source_key,campaign_id,lead_id,reply_category,next_action,next_action_at,metadata)
 values(c.name,named,r.email,phone,c.niche,'HOT_LEAD','LEAD_ENGINE',r.id::text,b.campaign_id,c.id::text,'POSITIVE',case when phone is null then 'PREPARE_DEMO_AND_ENRICH_PHONE' else 'CALL_HOT_LEAD' end,now(),jsonb_build_object('company_id',c.id,'reservation_id',r.id,'batch_id',b.id,'list_id',b.list_id,'route_id',r.route_id,'selection',r.snapshot)) returning id into oid;
 insert into public.crm_activity_events(opportunity_id,event_type,payload) values(oid,'LEAD_ENGINE_HANDOFF',jsonb_build_object('company_id',c.id,'reservation_id',r.id));
 end if;
 insert into lead_engine.crm_handoffs(reservation_id,company_id,opportunity_id) values(r.id,c.id,oid);
 return oid;
end $$;

alter function public.le_command(text,jsonb) rename to le_command_automation;
alter function public.le_command_automation(text,jsonb) set schema lead_engine;
create function public.le_command(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare r record; j uuid; result jsonb; key text; oid uuid; begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKEND_ONLY' using errcode='42501'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'OBJECT_PAYLOAD_REQUIRED'; end if;
 if p_action='retry_job' then
 if nullif(trim(p_payload->>'reason'),'') is null then raise exception 'RETRY_REASON_REQUIRED'; end if;
 select * into r from lead_engine.jobs where id=(p_payload->>'job_id')::uuid and status in ('FAILED','BLOCKED') for update;
 if not found then raise exception 'FAILED_OR_BLOCKED_JOB_REQUIRED'; end if;
 key:='recovery:'||r.id||':'||md5(p_payload->>'reason');
 insert into lead_engine.jobs(company_id,kind,idempotency_key,input,max_attempts) values(r.company_id,r.kind,key,r.input,r.max_attempts) on conflict(idempotency_key) do nothing returning id into j;
 if j is null then select id into j from lead_engine.jobs where idempotency_key=key; end if;
 insert into lead_engine.events(entity_type,entity_id,event_type,details) values('jobs',j::text,'RECOVERY_REQUESTED',jsonb_build_object('previous_job_id',r.id,'reason',p_payload->>'reason'));
 return jsonb_build_object('job_id',j,'previous_job_id',r.id);
 elsif p_action='record_cost' then
 if nullif(p_payload->>'evidence_ref','') is null then raise exception 'COST_EVIDENCE_REQUIRED'; end if;
 insert into lead_engine.cost_entries(idempotency_key,company_id,source_id,job_id,build_run_id,category,amount_eur,evidence_ref)
 values(p_payload->>'idempotency_key',(p_payload->>'company_id')::uuid,(p_payload->>'source_id')::uuid,(p_payload->>'job_id')::uuid,(p_payload->>'build_run_id')::uuid,p_payload->>'category',(p_payload->>'amount_eur')::numeric,p_payload->>'evidence_ref') on conflict(idempotency_key) do nothing returning id into j;
 return jsonb_build_object('cost_entry_id',j,'replayed',j is null);
 elsif p_action='outcome' then
 if p_payload->>'event_type' in ('WON','REVENUE') then raise exception 'CONFIRMED_PAYMENT_ADAPTER_REQUIRED'; end if;
 select * into r from lead_engine.outcomes where provider=p_payload->>'provider' and external_event_id=p_payload->>'external_event_id';
 if found and (r.reservation_id is distinct from (p_payload->>'reservation_id')::uuid or r.event_type is distinct from p_payload->>'event_type') then raise exception 'EVENT_IDEMPOTENCY_CONFLICT'; end if;
 result:=lead_engine.le_command_automation(p_action,p_payload);
 if p_payload->>'event_type'='POSITIVE' then oid:=lead_engine.crm_handoff((p_payload->>'reservation_id')::uuid); result:=result||jsonb_build_object('opportunity_id',oid); end if;
 return result;
 elsif p_action='approve_batch' then
 if not exists(select 1 from lead_engine.batches b join lead_engine.lists l on l.id=b.list_id where b.id=(p_payload->>'batch_id')::uuid and l.status in ('READY','ACTIVE')) then raise exception 'READY_LIST_REQUIRED'; end if;
 elsif p_action='reserve' then
 select * into r from lead_engine.list_members where id=(p_payload->>'member_id')::uuid;
 if r.route_id is distinct from lead_engine.select_route(r.company_id) then return jsonb_build_object('allowed',false,'reasons',jsonb_build_array('PREFERRED_CONTACT_REVIEW_REQUIRED')); end if;
 elsif p_action='enqueue' then
 select * into r from lead_engine.jobs where idempotency_key=p_payload->>'idempotency_key';
 if found and (r.company_id is distinct from (p_payload->>'company_id')::uuid or r.kind is distinct from p_payload->>'kind' or r.input is distinct from coalesce(p_payload->'input','{}'::jsonb)) then raise exception 'JOB_IDEMPOTENCY_CONFLICT'; end if;
 result:=lead_engine.le_command_automation(p_action,p_payload);
 if p_payload->>'kind'<>'WEBSITE_AUDIT' then
 update lead_engine.jobs set status='BLOCKED',error_code='NO_WORKER_CONFIGURED',error_detail='Use synchronous build_list or configure a provider worker.',updated_at=now() where id=(result->>'job_id')::uuid and status='QUEUED';
 insert into lead_engine.incidents(dedup_key,component,severity,summary,details) values('job:'||(result->>'job_id'),'jobs','WARNING','No executor configured for this job kind',result) on conflict do nothing;
 end if; return result;
 end if;
 return lead_engine.le_command_automation(p_action,p_payload);
end $$;
revoke execute on all functions in schema lead_engine from public,anon,authenticated;
grant execute on function lead_engine.crm_handoff(uuid),lead_engine.le_command_automation(text,jsonb) to service_role;
revoke execute on function public.le_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.le_command(text,jsonb) to service_role;
notify pgrst,'reload schema';
