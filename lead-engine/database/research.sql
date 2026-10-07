-- Separate pilot queue: never changes existing qualification or sends mail.
create table lead_engine.research_runs (
 id uuid primary key default gen_random_uuid(), list_id uuid not null references lead_engine.lists(id),
 run_key text unique not null, status text not null default 'PAUSED' check(status in ('PAUSED','ACTIVE','COMPLETE')),
 budget_usd numeric(12,6) not null default 0 check(budget_usd>=0), created_at timestamptz not null default now()
);
create table lead_engine.research_tasks (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references lead_engine.research_runs(id),
 company_id uuid not null references lead_engine.companies(id), member_id uuid not null references lead_engine.list_members(id),
 status text not null default 'QUEUED' check(status in ('QUEUED','RUNNING','REVIEW','ERROR')),
 attempts int not null default 0, lease_token uuid, lease_until timestamptz,
 policy_versions jsonb, start_receipt_id text, output jsonb, error_code text,
 updated_at timestamptz not null default now(), unique(run_id,company_id)
);
create index research_claim on lead_engine.research_tasks(run_id,status,updated_at);
create index research_company on lead_engine.research_tasks(company_id);
create index research_member on lead_engine.research_tasks(member_id);
create table lead_engine.research_spend (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references lead_engine.research_runs(id),
 task_id uuid not null references lead_engine.research_tasks(id), lease_token uuid not null,
 reserved_usd numeric(12,6) not null check(reserved_usd>0), actual_usd numeric(12,6) check(actual_usd>=0),
 provider_request_id text, usage jsonb, created_at timestamptz not null default now(), unique(task_id,lease_token)
);
create index research_spend_run on lead_engine.research_spend(run_id);
alter table lead_engine.research_runs enable row level security;
alter table lead_engine.research_tasks enable row level security;
alter table lead_engine.research_spend enable row level security;
revoke all on lead_engine.research_runs,lead_engine.research_tasks,lead_engine.research_spend from public,anon,authenticated;
grant select,insert,update on lead_engine.research_runs,lead_engine.research_tasks,lead_engine.research_spend to service_role;

create or replace function public.le_research(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
  return to_jsonb(t);
 end if;
 raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.le_research(text,jsonb) from public,anon,authenticated;
grant execute on function public.le_research(text,jsonb) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('lead-research-evidence','lead-research-evidence',false,10485760,array['image/jpeg','application/json']) on conflict(id) do nothing;
