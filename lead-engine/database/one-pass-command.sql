CREATE OR REPLACE FUNCTION public.le_command(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r record; j uuid; result jsonb; key text; oid uuid; begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKEND_ONLY' using errcode='42501'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'OBJECT_PAYLOAD_REQUIRED'; end if;

 if p_action in ('complete_qualification','qualify') then return lead_engine.complete_qualification(p_payload); end if;
 if p_action in ('handoff_check','handoff_queue','handoff_get','handoff_offer','handoff_accept','handoff_return') then return lead_engine.email_handoff_command(p_action,p_payload);end if;
 if p_action='start_work' then
 if nullif(trim(p_payload->>'actor'),'') is null or nullif(trim(p_payload->>'task'),'') is null then raise exception 'ACTOR_AND_TASK_REQUIRED'; end if;
 select jsonb_object_agg(b.slug,v.id::text) into result from public.bibles b join public.bible_versions v on v.bible_id=b.id and v.version=b.current_version where b.slug in ('lead-intelligence-bible','schilders-niche-bible','lead-engine-chat-context','cold-email-bible');
 insert into lead_engine.events(entity_type,entity_id,event_type,actor,details)
 values('policy_session',p_payload->>'task','BIBLE_START_RECEIPT',p_payload->>'actor',jsonb_build_object('versions',result,'task',p_payload->>'task','rubric_version','visual-holistic-v1')) returning id::text into key;
 return jsonb_build_object('start_receipt_id',key,'versions',result,'instruction','Read all returned Bibles and reference judgments before acting. Supply start_receipt_id on sourcing and list commands. Receipt records retrieval, not understanding.',
 'bibles',(select jsonb_agg(jsonb_build_object('slug',b.slug,'version_id',v.id,'version',v.version,'content_md',v.content_md) order by b.slug) from public.bibles b join public.bible_versions v on v.bible_id=b.id and v.version=b.current_version where b.slug in ('lead-intelligence-bible','schilders-niche-bible','lead-engine-chat-context','cold-email-bible')),
 'references',(select ls.value from lead_engine.settings ls where ls.key='visual_qualification_references'),
 'engine_status',lead_engine.le_command_automation('status','{}'::jsonb));
 end if;
 if p_action in ('ingest','qualify','build_list','create_list','add_member','approve_batch','reserve') then
 select jsonb_object_agg(b.slug,v.id::text) into result from public.bibles b join public.bible_versions v on v.bible_id=b.id and v.version=b.current_version where b.slug in ('lead-intelligence-bible','schilders-niche-bible','lead-engine-chat-context','cold-email-bible');
 if not exists(select 1 from lead_engine.events e where e.id::text=p_payload->>'start_receipt_id' and e.event_type='BIBLE_START_RECEIPT' and e.created_at between now()-interval '24 hours' and now()+interval '5 minutes' and e.details->'versions'=result) then raise exception 'CURRENT_BIBLE_START_REQUIRED: call start_work and read current Bibles first'; end if;
 end if;
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
end $function$;
