create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create table lead_engine.worker_invocations (
 request_id bigint primary key, created_at timestamptz not null default now(),
 checked_at timestamptz, http_status int, result jsonb, error text
);
alter table lead_engine.worker_invocations enable row level security;
revoke all on lead_engine.worker_invocations from public,anon,authenticated;
grant select on lead_engine.worker_invocations to service_role;

create function lead_engine.schedule_tick() returns jsonb language plpgsql security invoker set search_path='' as $$
declare request bigint; r record; n int:=0; response jsonb; begin
 perform pg_advisory_xact_lock(174019,2);
 perform lead_engine.watchdog();
 for r in select i.request_id,h.status_code,h.content,h.error_msg,h.timed_out from lead_engine.worker_invocations i
 join net._http_response h on h.id=i.request_id where i.checked_at is null loop
 begin response:=r.content::jsonb; exception when others then response:=null; end;
 update lead_engine.worker_invocations set checked_at=now(),http_status=r.status_code,result=response,error=r.error_msg where request_id=r.request_id;
 if r.status_code=200 then
 update lead_engine.integrations set status='AVAILABLE',last_success_at=now() where name='website_worker';
 update lead_engine.incidents set status='RESOLVED',resolved_at=now() where dedup_key='worker:http' and status<>'RESOLVED';
 else
 update lead_engine.integrations set status='ERROR' where name='website_worker';
 insert into lead_engine.incidents(dedup_key,component,severity,summary,details) values('worker:http','website_worker','CRITICAL','Scheduled worker request failed',jsonb_build_object('request_id',r.request_id,'status',r.status_code,'error',r.error_msg)) on conflict(dedup_key) do update set status='OPEN',resolved_at=null,details=excluded.details;
 end if; n:=n+1;
 end loop;
 update lead_engine.worker_invocations set checked_at=now(),error='RESPONSE_TIMEOUT' where checked_at is null and created_at<now()-interval '10 minutes';
 if exists(select 1 from lead_engine.worker_invocations where error='RESPONSE_TIMEOUT' and created_at>now()-interval '15 minutes') then
 insert into lead_engine.incidents(dedup_key,component,severity,summary) values('worker:timeout','website_worker','WARNING','Scheduled worker response missing') on conflict(dedup_key) do update set status='OPEN',resolved_at=null;
 end if;
 if (select value from lead_engine.settings where key='processing_enabled')='true'::jsonb
 and exists(select 1 from lead_engine.jobs where kind='WEBSITE_AUDIT' and status in ('QUEUED','RETRY_WAIT') and run_after<=now())
 and not exists(select 1 from lead_engine.worker_invocations where checked_at is null and created_at>now()-interval '2 minutes') then
 select net.http_post(url:='https://skdjbifmtleiogbkqwid.supabase.co/functions/v1/lead-engine',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='lead_engine_worker_v1')),
 body:='{"action":"run_once"}'::jsonb,timeout_milliseconds:=60000) into request;
 insert into lead_engine.worker_invocations(request_id) values(request);
 end if;
 return jsonb_build_object('collected',n,'request_id',request);
end $$;
revoke execute on function lead_engine.schedule_tick() from public,anon,authenticated,service_role;
select cron.schedule('lead-engine-tick','* * * * *','select lead_engine.schedule_tick();');
update lead_engine.integrations set status='AVAILABLE',last_success_at=now(),notes='Supabase Edge Function lead-engine; scoped Vault token; pg_cron runs each minute when due WEBSITE_AUDIT jobs exist; results recorded in worker_invocations.' where name='website_worker';
insert into lead_engine.components(name,status,location,description) values
 ('database','DEPLOYED','Supabase:lead_engine','Canonical companies, contacts, evidence, lists, jobs, reservations and audit trail'),
 ('backend_api','DEPLOYED','Supabase Edge Function:lead-engine','Service-only commands; limited worker token allows status and run_once only'),
 ('worker_scheduler','ACTIVE','cron:lead-engine-tick','Runs each minute; one website job per invocation; skips idle and paused queue'),
 ('watchdog','ACTIVE','lead_engine.schedule_tick()','Lease expiry, dispatch uncertainty and stale queue detection'),
 ('external_integrations','BLOCKED','lead_engine.integrations','Sourcing provider, live verifier and Smartlead still require configured adapters/credentials');
