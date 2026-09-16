-- Scoped credential for scheduled website work. Never expose the Vault value.
create table lead_engine.worker_tokens (
 name text primary key, digest text not null unique,
 scopes text[] not null default array['run_once','status'], enabled boolean not null default true,
 created_at timestamptz not null default now()
);
alter table lead_engine.worker_tokens enable row level security;
revoke all on lead_engine.worker_tokens from public,anon,authenticated;
grant select on lead_engine.worker_tokens to service_role;
do $$ declare secret text; begin
 secret:='le_worker_'||encode(extensions.gen_random_bytes(32),'hex');
 perform vault.create_secret(secret,'lead_engine_worker_v1','Scoped internal website worker credential; never print');
 insert into lead_engine.worker_tokens(name,digest) values('website-scheduler-v1',encode(extensions.digest(secret,'sha256'),'hex'));
end $$;

alter function public.le_command(text,jsonb) rename to le_command_operations;
alter function public.le_command_operations(text,jsonb) set schema lead_engine;
create function public.le_command(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare allowed boolean; begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKEND_ONLY' using errcode='42501'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'OBJECT_PAYLOAD_REQUIRED'; end if;
 if p_action='authenticate_worker' then
 select exists(select 1 from lead_engine.worker_tokens where digest=p_payload->>'digest' and enabled and p_payload->>'action'=any(scopes)) into allowed;
 return jsonb_build_object('allowed',allowed);
 end if;
 return lead_engine.le_command_operations(p_action,p_payload);
end $$;
revoke execute on function lead_engine.le_command_operations(text,jsonb) from public,anon,authenticated;
grant execute on function lead_engine.le_command_operations(text,jsonb) to service_role;
revoke execute on function public.le_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.le_command(text,jsonb) to service_role;

create function lead_engine.watchdog() returns jsonb language plpgsql security invoker set search_path='' as $$
declare recovered jsonb; o record; n int:=0; begin
 recovered:=lead_engine.recover_jobs();
 for o in select * from lead_engine.outbox where status='DISPATCHING' and updated_at<now()-interval '10 minutes' for update skip locked loop
 update lead_engine.outbox set status='RECONCILE',error='DISPATCH_ACK_TIMEOUT',updated_at=now() where id=o.id;
 update lead_engine.reservations set status='RECONCILE' where id=o.reservation_id and status='DISPATCHING';
 insert into lead_engine.incidents(dedup_key,component,severity,summary,details) values('dispatch:'||o.id,'outreach','CRITICAL','Dispatch acknowledgement missing; no automatic resend',jsonb_build_object('outbox_id',o.id)) on conflict do nothing;
 n:=n+1; end loop;
 if exists(select 1 from lead_engine.jobs where status in ('QUEUED','RETRY_WAIT') and run_after<now()-interval '30 minutes') and (select value from lead_engine.settings where key='processing_enabled')='true'::jsonb then
 insert into lead_engine.incidents(dedup_key,component,severity,summary) values('queue:stale','jobs','WARNING','Due work has waited more than 30 minutes') on conflict(dedup_key) do update set status='OPEN',resolved_at=null;
 else update lead_engine.incidents set status='RESOLVED',resolved_at=now() where dedup_key='queue:stale' and status<>'RESOLVED'; end if;
 return jsonb_build_object('job_recovery',recovered,'dispatch_reconciliation',n);
end $$;
revoke execute on function lead_engine.watchdog() from public,anon,authenticated;
grant execute on function lead_engine.watchdog() to service_role;
notify pgrst,'reload schema';
