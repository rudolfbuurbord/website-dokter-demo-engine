-- Applied through the Supabase migration API; additive, no existing data rewritten.
create schema lead_engine;
revoke all on schema lead_engine from public, anon, authenticated;
grant usage on schema lead_engine to service_role;
alter default privileges in schema lead_engine revoke execute on functions from public;

create table lead_engine.settings (
 key text primary key, value jsonb not null, updated_at timestamptz not null default now()
);
insert into lead_engine.settings values
 ('processing_enabled','true',now()),('outreach_enabled','false',now()),
 ('verification_max_age_days','14',now()),('qualification_max_age_days','30',now());

create table lead_engine.sources (
 id uuid primary key default gen_random_uuid(), slug text not null unique,
 name text not null, enabled boolean not null default true,
 adapter text not null default 'supplied_records', created_at timestamptz not null default now()
);
create table lead_engine.companies (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name))>1),
 domain text, website text, kvk text check(kvk is null or kvk ~ '^[0-9]{8}$'),
 niche text, country text check(country is null or country ~ '^[A-Z]{2}$'), city text,
 active_status text not null default 'UNKNOWN' check(active_status in ('ACTIVE','INACTIVE','UNKNOWN')),
 identity_status text not null default 'REVIEW' check(identity_status in ('CLEAR','REVIEW','MERGED')),
 merged_into uuid references lead_engine.companies(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(merged_into is null or merged_into <> id)
);
create unique index le_company_kvk on lead_engine.companies(kvk) where kvk is not null;
create index le_company_domain on lead_engine.companies(domain);
create table lead_engine.identifiers (
 namespace text not null, value text not null, company_id uuid not null references lead_engine.companies,
 source_url text not null, created_at timestamptz not null default now(), primary key(namespace,value)
);
create table lead_engine.source_records (
 id uuid primary key default gen_random_uuid(), source_id uuid not null references lead_engine.sources,
 external_id text not null, fingerprint text not null, source_url text not null,
 observed_at timestamptz not null, payload jsonb not null,
 company_id uuid references lead_engine.companies,
 status text not null check(status in ('IMPORTED','REVIEW')),
 created_at timestamptz not null default now(), unique(source_id,external_id,fingerprint)
);
create table lead_engine.contacts (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references lead_engine.companies,
 name text not null, role text not null default 'UNKNOWN'
 check(role in ('OWNER','DIRECTOR','MANAGEMENT','MARKETING','OTHER','UNKNOWN')),
 source_url text not null, observed_at timestamptz not null, unique(company_id,id)
);
create table lead_engine.contact_routes (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references lead_engine.companies,
 contact_id uuid, kind text not null check(kind in ('EMAIL','PHONE','WEBSITE')),
 value text not null check(length(trim(value))>0), source_url text not null,
 observed_at timestamptz not null, reader_certainty text not null default 'UNKNOWN'
 check(reader_certainty in ('UNKNOWN','EVIDENCED')),
 is_role_mailbox boolean, is_inferred boolean not null default false,
 enabled boolean not null default true, unique(company_id,kind,value), unique(company_id,id),
 foreign key(company_id,contact_id) references lead_engine.contacts(company_id,id),
 check(kind <> 'EMAIL' or (value=lower(trim(value)) and value ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
);
create table lead_engine.observations (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references lead_engine.companies,
 source_record_id uuid references lead_engine.source_records, field text not null,
 layer text not null check(layer in ('RAW_FACT','DERIVED_FEATURE','MANUAL_CORRECTION')),
 value jsonb not null, source_url text not null, observed_at timestamptz not null,
 confidence numeric check(confidence between 0 and 1), method text not null,
 created_at timestamptz not null default now()
);
create table lead_engine.website_audits (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references lead_engine.companies,
 url text not null, status text not null check(status in ('OK','UNREACHABLE','BLOCKED')),
 findings jsonb not null, method_version text not null, checked_at timestamptz not null default now()
);
create table lead_engine.jobs (
 id uuid primary key default gen_random_uuid(), company_id uuid references lead_engine.companies,
 kind text not null check(kind in ('WEBSITE_AUDIT','CONTACT_RESEARCH','EMAIL_VERIFY','LIST_BUILD','RECONCILE')),
 idempotency_key text not null unique, input jsonb not null default '{}', output jsonb,
 status text not null default 'QUEUED' check(status in ('QUEUED','RUNNING','SUCCEEDED','RETRY_WAIT','BLOCKED','FAILED','CANCELLED')),
 attempt_count int not null default 0 check(attempt_count >= 0), max_attempts int not null default 3 check(max_attempts between 1 and 10),
 run_after timestamptz not null default now(), worker text, lease_token uuid, lease_until timestamptz,
 error_code text, error_detail text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(status <> 'RUNNING' or (lease_token is not null and lease_until is not null))
);
create index le_jobs_queue on lead_engine.jobs(run_after,created_at) where status in ('QUEUED','RETRY_WAIT');
create table lead_engine.job_attempts (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references lead_engine.jobs,
 attempt int not null, token uuid not null unique, worker text not null,
 started_at timestamptz not null default now(), finished_at timestamptz, outcome text, error_code text,
 unique(job_id,attempt)
);
create table lead_engine.events (
 id bigint generated always as identity primary key, entity_type text not null, entity_id text not null,
 event_type text not null, actor text not null default current_user,
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table lead_engine.incidents (
 id uuid primary key default gen_random_uuid(), dedup_key text not null unique,
 component text not null, severity text not null check(severity in ('INFO','WARNING','CRITICAL')),
 status text not null default 'OPEN' check(status in ('OPEN','ACKNOWLEDGED','RESOLVED')),
 summary text not null, details jsonb not null default '{}',
 created_at timestamptz not null default now(), resolved_at timestamptz
);
create table lead_engine.experiments (
 id uuid primary key default gen_random_uuid(), name text not null, hypothesis text not null,
 primary_metric text not null default 'contribution_profit_per_qualified_prospect',
 status text not null default 'DRAFT', created_at timestamptz not null default now()
);
create table lead_engine.segments (
 id uuid primary key default gen_random_uuid(), name text not null, criteria jsonb not null,
 version int not null default 1 check(version>0), created_at timestamptz not null default now()
);
create table lead_engine.lists (
 id uuid primary key default gen_random_uuid(), name text not null,
 purpose text not null check(purpose in ('EXPLORATION','VALIDATION','PRODUCTION','EXPANSION','BASELINE')),
 niche text not null, country text not null default 'NL' check(country='NL'),
 selection_logic jsonb not null, experiment_id uuid references lead_engine.experiments,
 status text not null default 'DRAFT' check(status in ('DRAFT','BUILDING','QA','READY','ACTIVE','EXHAUSTED','ARCHIVED')),
 version int not null default 1 check(version>0), created_at timestamptz not null default now()
);
create table lead_engine.build_runs (
 id uuid primary key default gen_random_uuid(), list_id uuid not null references lead_engine.lists,
 status text not null default 'RUNNING' check(status in ('RUNNING','SUCCEEDED','FAILED')),
 criteria_snapshot jsonb not null, counts jsonb not null default '{}',
 cost_eur numeric(12,4) not null default 0 check(cost_eur>=0),
 started_at timestamptz not null default now(), completed_at timestamptz
);
create table lead_engine.list_members (
 id uuid primary key default gen_random_uuid(), list_id uuid not null references lead_engine.lists,
 company_id uuid not null references lead_engine.companies, route_id uuid,
 segment_id uuid references lead_engine.segments, build_run_id uuid references lead_engine.build_runs,
 selection_reason text not null, selection_snapshot jsonb not null,
 qualification text not null default 'PENDING' check(qualification in ('PENDING','APPROVED','REJECTED')),
 qualification_source text, qualified_by text, qualified_at timestamptz,
 created_at timestamptz not null default now(), unique(list_id,company_id), unique(id,company_id),
 foreign key(company_id,route_id) references lead_engine.contact_routes(company_id,id),
 check(qualification <> 'APPROVED' or (qualification_source is not null and qualified_by is not null and qualified_at is not null))
);
create table lead_engine.batches (
 id uuid primary key default gen_random_uuid(), list_id uuid not null references lead_engine.lists,
 name text not null, campaign_id text,
 status text not null default 'DRAFT' check(status in ('DRAFT','APPROVED','ACTIVE','PAUSED','COMPLETED','CANCELLED')),
 approved_by text, approved_at timestamptz, created_at timestamptz not null default now(),
 check(status not in ('APPROVED','ACTIVE') or (approved_by is not null and approved_at is not null))
);
create table lead_engine.reservations (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references lead_engine.companies,
 route_id uuid not null, member_id uuid not null, batch_id uuid not null references lead_engine.batches,
 email text not null,
 status text not null default 'RESERVED' check(status in ('RESERVED','DISPATCHING','ACTIVE','RECONCILE','COMPLETED','CANCELLED','BLOCKED')),
 snapshot jsonb not null, created_at timestamptz not null default now(), finished_at timestamptz,
 foreign key(company_id,route_id) references lead_engine.contact_routes(company_id,id),
 foreign key(member_id,company_id) references lead_engine.list_members(id,company_id),
 unique(batch_id,company_id)
);
create unique index le_one_active_company on lead_engine.reservations(company_id)
 where status in ('RESERVED','DISPATCHING','ACTIVE','RECONCILE');
create unique index le_one_active_email on lead_engine.reservations(email)
 where status in ('RESERVED','DISPATCHING','ACTIVE','RECONCILE');
create table lead_engine.outbox (
 id uuid primary key default gen_random_uuid(), reservation_id uuid not null unique references lead_engine.reservations,
 destination text not null default 'SMARTLEAD', payload jsonb not null,
 status text not null default 'PENDING' check(status in ('PENDING','DISPATCHING','ACKNOWLEDGED','RECONCILE','CANCELLED')),
 external_id text, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table lead_engine.company_blocks (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references lead_engine.companies,
 reason text not null, source_ref text not null, active boolean not null default true,
 created_at timestamptz not null default now(), unique(company_id,reason)
);
create table lead_engine.outcomes (
 id uuid primary key default gen_random_uuid(), provider text not null, external_event_id text not null,
 reservation_id uuid not null references lead_engine.reservations,
 event_type text not null check(event_type in ('DELIVERED','REPLY','POSITIVE','NEGATIVE','UNSUBSCRIBE','BOUNCE','COMPLAINT','SEQUENCE_COMPLETED','MEETING','WON','REVENUE')),
 occurred_at timestamptz not null, data jsonb not null default '{}', created_at timestamptz not null default now(),
 unique(provider,external_event_id)
);
create table lead_engine.integrations (
 name text primary key, status text not null check(status in ('AVAILABLE','NOT_CONFIGURED','DISABLED','ERROR')),
 config jsonb not null default '{}', last_success_at timestamptz, notes text not null
);
create table lead_engine.components (
 name text primary key, status text not null, location text not null, description text not null,
 updated_at timestamptz not null default now()
);
create table lead_engine.releases (
 version text primary key, migration_name text not null, git_commit text, git_branch text,
 validation jsonb not null default '{}', deployed_at timestamptz not null default now()
);
create table lead_engine.runbooks (
 key text primary key, title text not null, content_md text not null, updated_at timestamptz not null default now()
);

-- Every FK gets an index; small pilot now, predictable joins later.
do $$ declare r record; begin
 for r in select c.conrelid::regclass as tbl,a.attname
 from pg_constraint c join pg_namespace n on n.oid=c.connamespace
 join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
 where n.nspname='lead_engine' and c.contype='f'
 loop execute format('create index if not exists %I on %s (%I)', 'le_fk_'||replace(r.tbl::text,'lead_engine.','')||'_'||r.attname,r.tbl,r.attname); end loop;
end $$;

create function lead_engine.audit_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare oldj jsonb; newj jsonb; begin
 oldj:=case when TG_OP='INSERT' then null else to_jsonb(OLD) end;
 newj:=case when TG_OP='DELETE' then null else to_jsonb(NEW) end;
 insert into lead_engine.events(entity_type,entity_id,event_type,details)
 values(TG_TABLE_NAME,coalesce(newj->>'id',oldj->>'id',newj->>'key',newj->>'name',oldj->>'name','singleton'),TG_OP,
 jsonb_build_object('old',oldj,'new',newj));
 if TG_OP='DELETE' then return OLD; end if; return NEW;
end $$;
do $$ declare t text; begin
 foreach t in array array['companies','contacts','contact_routes','list_members','lists','batches','reservations','jobs','company_blocks','settings','integrations'] loop
 execute format('create trigger audit_change after insert or update or delete on lead_engine.%I for each row execute function lead_engine.audit_change()',t);
 end loop;
end $$;

create function lead_engine.domain_of(v text) returns text language plpgsql immutable security invoker set search_path='' as $$
declare d text; begin
 if v is null or trim(v)='' then return null; end if;
 d:=lower(split_part(regexp_replace(trim(v),'^https?://','','i'),'/',1));
 d:=regexp_replace(d,'^www\.','');
 if d !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$' then raise exception 'INVALID_DOMAIN'; end if;
 return d;
end $$;

create function lead_engine.ingest(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s uuid; cid uuid; existing uuid; domain_id uuid; ids uuid[]; rec uuid; d text; k text; fp text; oldrec record; f text; stat text:='CLEAR'; obs timestamptz; begin
 if nullif(trim(p->>'source'),'') is null or nullif(trim(p->>'external_id'),'') is null or nullif(trim(p->>'source_url'),'') is null or length(trim(coalesce(p->>'company_name','')))<2 then raise exception 'SOURCE_ID_URL_AND_COMPANY_REQUIRED'; end if;
 obs:=coalesce((p->>'observed_at')::timestamptz,now());
 if obs>now()+interval '5 minutes' then raise exception 'FUTURE_OBSERVATION'; end if;
 d:=lead_engine.domain_of(coalesce(nullif(p->>'website',''),p->>'domain')); k:=nullif(trim(p->>'kvk'),'');
 if k is not null and k !~ '^[0-9]{8}$' then raise exception 'INVALID_KVK'; end if;
 -- Serialise identity resolution for the pilot. No fuzzy or blind name merges.
 perform pg_advisory_xact_lock(174019,1);
 insert into lead_engine.sources(slug,name) values(p->>'source',p->>'source') on conflict(slug) do nothing;
 select id into s from lead_engine.sources where slug=p->>'source' and enabled;
 if s is null then raise exception 'SOURCE_DISABLED'; end if;
 fp:=md5(p::text);
 select * into oldrec from lead_engine.source_records where source_id=s and external_id=p->>'external_id' and fingerprint=fp;
 if found then return jsonb_build_object('company_id',oldrec.company_id,'source_record_id',oldrec.id,'status',oldrec.status,'replayed',true); end if;
 select company_id into existing from lead_engine.identifiers where namespace='source:'||(p->>'source') and value=p->>'external_id';
 if k is not null then select id into cid from lead_engine.companies where kvk=k; end if;
 if d is not null then
 select array_agg(id) into ids from lead_engine.companies where domain=d and merged_into is null;
 if cardinality(ids)=1 then domain_id:=ids[1]; elsif cardinality(ids)>1 then stat:='REVIEW'; end if;
 end if;
 if (existing is not null and cid is not null and existing<>cid) or
 (coalesce(existing,cid) is not null and domain_id is not null and coalesce(existing,cid)<>domain_id) or
 (k is not null and exists(select 1 from lead_engine.companies where id=coalesce(existing,cid,domain_id) and kvk is not null and kvk<>k)) then stat:='REVIEW'; end if;
 if stat='REVIEW' then
 insert into lead_engine.source_records(source_id,external_id,fingerprint,source_url,observed_at,payload,status)
 values(s,p->>'external_id',fp,p->>'source_url',obs,p,'REVIEW') returning id into rec;
 insert into lead_engine.incidents(dedup_key,component,severity,summary,details)
 values('identity:'||rec,'identity','WARNING','Conflicting company identifiers; manual resolution required',jsonb_build_object('source_record_id',rec));
 return jsonb_build_object('status','REVIEW','source_record_id',rec);
 end if;
 cid:=coalesce(existing,cid,domain_id);
 if cid is null then
 insert into lead_engine.companies(name,domain,website,kvk,niche,country,city,active_status,identity_status)
 values(trim(p->>'company_name'),d,p->>'website',k,lower(p->>'niche'),upper(p->>'country'),p->>'city',coalesce(p->>'active_status','UNKNOWN'),case when d is null and k is null then 'REVIEW' else 'CLEAR' end) returning id into cid;
 else
 -- Fill gaps only; conflicting or changed observations remain visible for human review.
 update lead_engine.companies set domain=coalesce(domain,d),website=coalesce(website,p->>'website'),kvk=coalesce(kvk,k),updated_at=now() where id=cid;
 end if;
 insert into lead_engine.identifiers(namespace,value,company_id,source_url) values('source:'||(p->>'source'),p->>'external_id',cid,p->>'source_url') on conflict do nothing;
 insert into lead_engine.source_records(source_id,external_id,fingerprint,source_url,observed_at,payload,company_id,status)
 values(s,p->>'external_id',fp,p->>'source_url',obs,p,cid,'IMPORTED') returning id into rec;
 foreach f in array array['company_name','website','kvk','niche','country','city','active_status','services','reviews','logo','projects'] loop
 if p ? f then insert into lead_engine.observations(company_id,source_record_id,field,layer,value,source_url,observed_at,method)
 values(cid,rec,f,'RAW_FACT',p->f,p->>'source_url',obs,'supplied_record'); end if; end loop;
 if p->>'website' like 'https://%' then
 insert into lead_engine.jobs(company_id,kind,idempotency_key,input) values(cid,'WEBSITE_AUDIT','website:'||cid||':'||md5(p->>'website'),jsonb_build_object('url',p->>'website')) on conflict do nothing;
 end if;
 return jsonb_build_object('company_id',cid,'source_record_id',rec,'status','IMPORTED','replayed',false);
end $$;

create function lead_engine.gate(member uuid, own_reservation uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
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
end $$;

create function lead_engine.reserve(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m record; b record; g jsonb; rid uuid; oid uuid; snap jsonb; begin
 select * into m from lead_engine.list_members where id=(p->>'member_id')::uuid;
 if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
 perform 1 from lead_engine.companies where id=m.company_id for update;
 select * into b from lead_engine.batches where id=(p->>'batch_id')::uuid for update;
 if not found or b.list_id<>m.list_id or b.status not in ('APPROVED','ACTIVE') then raise exception 'APPROVED_MATCHING_BATCH_REQUIRED'; end if;
 select id into rid from lead_engine.reservations where batch_id=b.id and company_id=m.company_id;
 if rid is not null then return jsonb_build_object('reservation_id',rid,'replayed',true); end if;
 g:=lead_engine.gate(m.id);
 insert into public.outreach_send_gate_log(email,verification_status,suppression_hit,decision,reason,campaign_id,metadata)
 values(coalesce(g->>'email','UNKNOWN'),case when (g->>'allowed')::boolean then 'valid' else null end,
 (g->'reasons') ? 'EMAIL_SUPPRESSED',case when (g->>'allowed')::boolean then 'allow' else 'block' end,(g->'reasons')::text,b.campaign_id,g);
 if not (g->>'allowed')::boolean then return g; end if;
 snap:=jsonb_build_object('gate',g,'selection',m.selection_snapshot,'list_id',m.list_id,'segment_id',m.segment_id,'build_run_id',m.build_run_id,'qualified_at',m.qualified_at);
 begin
 insert into lead_engine.reservations(company_id,route_id,member_id,batch_id,email,snapshot) values(m.company_id,m.route_id,m.id,b.id,g->>'email',snap) returning id into rid;
 exception when unique_violation then return jsonb_build_object('allowed',false,'reasons',jsonb_build_array('CONCURRENT_OUTREACH_CONFLICT')); end;
 insert into lead_engine.outbox(reservation_id,payload) values(rid,jsonb_build_object('company_id',m.company_id,'route_id',m.route_id,'list_id',m.list_id,'batch_id',b.id,'campaign_id',b.campaign_id,'email',g->>'email','snapshot',snap)) returning id into oid;
 return jsonb_build_object('allowed',true,'reservation_id',rid,'outbox_id',oid,'status','RESERVED');
end $$;

create function lead_engine.claim_job(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j lead_engine.jobs; tok uuid:=gen_random_uuid(); begin
 if nullif(p->>'worker','') is null or jsonb_typeof(p->'kinds') is distinct from 'array' then raise exception 'WORKER_AND_KINDS_REQUIRED'; end if;
 if (select value from lead_engine.settings where key='processing_enabled')<>'true'::jsonb then return jsonb_build_object('paused',true); end if;
 select * into j from lead_engine.jobs where status in ('QUEUED','RETRY_WAIT') and run_after<=now() and attempt_count<max_attempts and kind in (select jsonb_array_elements_text(p->'kinds')) order by run_after,created_at for update skip locked limit 1;
 if not found then return '{}'::jsonb; end if;
 update lead_engine.jobs set status='RUNNING',worker=p->>'worker',lease_token=tok,lease_until=now()+interval '5 minutes',attempt_count=attempt_count+1,updated_at=now() where id=j.id returning * into j;
 insert into lead_engine.job_attempts(job_id,attempt,token,worker) values(j.id,j.attempt_count,tok,j.worker);
 return to_jsonb(j);
end $$;

create function lead_engine.finish_job(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j lead_engine.jobs; st text; outcome text:=p->>'outcome'; begin
 select * into j from lead_engine.jobs where id=(p->>'job_id')::uuid for update;
 if not found or j.status<>'RUNNING' or j.lease_token is distinct from (p->>'lease_token')::uuid or j.lease_until<=now() then raise exception 'STALE_OR_INVALID_LEASE'; end if;
 if outcome not in ('SUCCEEDED','RETRY','BLOCKED','FAILED') or outcome is null then raise exception 'INVALID_OUTCOME'; end if;
 st:=case when outcome='RETRY' and j.attempt_count<j.max_attempts then 'RETRY_WAIT' when outcome='RETRY' then 'FAILED' else outcome end;
 if st='SUCCEEDED' and j.kind='WEBSITE_AUDIT' then
 if p#>>'{output,status}' not in ('OK','UNREACHABLE','BLOCKED') or p#>>'{output,status}' is null then raise exception 'AUDIT_STATUS_REQUIRED'; end if;
 insert into lead_engine.website_audits(company_id,url,status,findings,method_version)
 values(j.company_id,j.input->>'url',p#>>'{output,status}',coalesce(p#>'{output,findings}','{}'),coalesce(p#>>'{output,method_version}','static-html-v1'));
 end if;
 update lead_engine.jobs set status=st,output=p->'output',error_code=p->>'error_code',error_detail=left(p->>'error_detail',2000),lease_until=null,lease_token=null,
 run_after=case when st='RETRY_WAIT' then now()+make_interval(secs=>least(3600,30*power(2,j.attempt_count)::int)) else run_after end,updated_at=now() where id=j.id;
 update lead_engine.job_attempts set finished_at=now(),outcome=st,error_code=p->>'error_code' where token=j.lease_token;
 if st in ('FAILED','BLOCKED') then insert into lead_engine.incidents(dedup_key,component,severity,summary,details)
 values('job:'||j.id,'jobs','WARNING',coalesce(p->>'error_code','JOB_'||st),jsonb_build_object('job_id',j.id,'detail',left(p->>'error_detail',2000))) on conflict(dedup_key) do update set status='OPEN',resolved_at=null; end if;
 return jsonb_build_object('job_id',j.id,'status',st);
end $$;

create function lead_engine.recover_jobs() returns jsonb language plpgsql security invoker set search_path='' as $$
declare j record; n int:=0; st text; begin
 for j in select * from lead_engine.jobs where status='RUNNING' and lease_until<now() for update skip locked loop
 st:=case when j.attempt_count<j.max_attempts then 'RETRY_WAIT' else 'FAILED' end;
 update lead_engine.jobs set status=st,lease_token=null,lease_until=null,error_code='LEASE_EXPIRED',run_after=now()+interval '1 minute',updated_at=now() where id=j.id;
 update lead_engine.job_attempts set finished_at=now(),outcome='LEASE_EXPIRED',error_code='LEASE_EXPIRED' where token=j.lease_token;
 insert into lead_engine.incidents(dedup_key,component,severity,summary,details) values('lease:'||j.id,'jobs','WARNING','Worker lease expired',jsonb_build_object('job_id',j.id,'recovery',st)) on conflict(dedup_key) do update set status='OPEN',resolved_at=null;
 n:=n+1; end loop;
 return jsonb_build_object('recovered',n);
end $$;

create function lead_engine.process_outcome(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r lead_engine.reservations; e uuid; kind text:=p->>'event_type'; begin
 if nullif(p->>'provider','') is null or nullif(p->>'external_event_id','') is null then raise exception 'EVENT_ID_REQUIRED'; end if;
 select * into r from lead_engine.reservations where id=(p->>'reservation_id')::uuid for update;
 if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
 insert into lead_engine.outcomes(provider,external_event_id,reservation_id,event_type,occurred_at,data)
 values(p->>'provider',p->>'external_event_id',r.id,kind,coalesce((p->>'occurred_at')::timestamptz,now()),coalesce(p->'data','{}')) on conflict do nothing returning id into e;
 if e is null then return jsonb_build_object('replayed',true); end if;
 if kind in ('UNSUBSCRIBE','COMPLAINT','BOUNCE','NEGATIVE','POSITIVE','REPLY') then
 insert into lead_engine.company_blocks(company_id,reason,source_ref) values(r.company_id,kind,'outcome:'||e) on conflict(company_id,reason) do update set active=true;
 if kind in ('UNSUBSCRIBE','COMPLAINT','BOUNCE','NEGATIVE') then
 insert into public.email_suppressions(email,reason,source,metadata) values(r.email,case kind when 'UNSUBSCRIBE' then 'unsubscribe' when 'COMPLAINT' then 'spam_complaint' when 'BOUNCE' then 'hard_bounce' else 'negative_reply' end,'LEAD_ENGINE',jsonb_build_object('outcome_id',e));
 end if;
 update lead_engine.reservations set status='BLOCKED',finished_at=now() where company_id=r.company_id and status='RESERVED';
 update lead_engine.outbox set status='CANCELLED',updated_at=now() where reservation_id in (select id from lead_engine.reservations where company_id=r.company_id and status='BLOCKED') and status='PENDING';
 if r.status in ('ACTIVE','DISPATCHING','RECONCILE') then
 update lead_engine.reservations set status='RECONCILE' where id=r.id;
 insert into lead_engine.incidents(dedup_key,component,severity,summary,details) values('stop:'||r.id,'outreach','CRITICAL','Confirm external sequence stopped before releasing company',jsonb_build_object('reservation_id',r.id,'event',kind)) on conflict(dedup_key) do nothing;
 end if;
 elsif kind='SEQUENCE_COMPLETED' then
 -- Provider completion alone is not proof of no reply; any reply event holds the company.
 if not exists(select 1 from lead_engine.company_blocks where company_id=r.company_id and active) then
 update lead_engine.reservations set status='COMPLETED',finished_at=now() where id=r.id and status='ACTIVE';
 end if;
 end if;
 return jsonb_build_object('event_id',e,'status','RECORDED');
end $$;

create view lead_engine.system_status with (security_invoker=true) as
 select 'companies' as metric,count(*)::bigint as value from lead_engine.companies
 union all select 'identity_review',count(*) from lead_engine.companies where identity_status='REVIEW'
 union all select 'jobs_queued',count(*) from lead_engine.jobs where status in ('QUEUED','RETRY_WAIT')
 union all select 'jobs_running',count(*) from lead_engine.jobs where status='RUNNING'
 union all select 'jobs_failed_or_blocked',count(*) from lead_engine.jobs where status in ('FAILED','BLOCKED')
 union all select 'leases_expired',count(*) from lead_engine.jobs where status='RUNNING' and lease_until<now()
 union all select 'open_incidents',count(*) from lead_engine.incidents where status<>'RESOLVED'
 union all select 'pending_outbox',count(*) from lead_engine.outbox where status='PENDING';

create function public.le_command(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cid uuid; rid uuid; contact uuid; lid uuid; bid uuid; mid uuid; j uuid; obs timestamptz; val text; result jsonb; rec record; cnt int:=0; begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKEND_ONLY' using errcode='42501'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'OBJECT_PAYLOAD_REQUIRED'; end if;
 case p_action
 when 'ingest' then return lead_engine.ingest(p_payload);
 when 'contact' then
 cid:=(p_payload->>'company_id')::uuid; val:=trim(p_payload->>'value'); obs:=coalesce((p_payload->>'observed_at')::timestamptz,now());
 if nullif(p_payload->>'source_url','') is null or val is null or obs>now()+interval '5 minutes' then raise exception 'CONTACT_EVIDENCE_REQUIRED'; end if;
 if p_payload->>'kind'='EMAIL' then val:=lower(val); end if;
 perform 1 from lead_engine.companies where id=cid for update;
 if not found then raise exception 'COMPANY_NOT_FOUND'; end if;
 select id into rid from lead_engine.contact_routes where company_id=cid and kind=p_payload->>'kind' and value=val;
 if rid is not null then return jsonb_build_object('route_id',rid,'replayed',true); end if;
 if nullif(p_payload->>'contact_name','') is not null then
 insert into lead_engine.contacts(company_id,name,role,source_url,observed_at) values(cid,p_payload->>'contact_name',coalesce(p_payload->>'role','UNKNOWN'),p_payload->>'source_url',obs) returning id into contact;
 end if;
 insert into lead_engine.contact_routes(company_id,contact_id,kind,value,source_url,observed_at,is_role_mailbox,is_inferred)
 values(cid,contact,p_payload->>'kind',val,p_payload->>'source_url',obs,(p_payload->>'is_role_mailbox')::boolean,coalesce((p_payload->>'is_inferred')::boolean,false)) returning id into rid;
 return jsonb_build_object('route_id',rid,'contact_id',contact);
 when 'verification' then
 if nullif(p_payload->>'verifier','') is null or nullif(p_payload->>'evidence_ref','') is null then raise exception 'VERIFIER_AND_EVIDENCE_REQUIRED'; end if;
 obs:=coalesce((p_payload->>'checked_at')::timestamptz,now()); if obs>now()+interval '5 minutes' then raise exception 'FUTURE_VERIFICATION'; end if;
 select value into val from lead_engine.contact_routes where id=(p_payload->>'route_id')::uuid and kind='EMAIL';
 if val is null then raise exception 'EMAIL_ROUTE_REQUIRED'; end if;
 insert into public.email_verifications(email,verification_status,verifier,is_catch_all,checked_at,raw_result)
 values(val,p_payload->>'status',p_payload->>'verifier',(p_payload->>'is_catch_all')::boolean,obs,jsonb_build_object('evidence_ref',p_payload->>'evidence_ref','route_id',p_payload->>'route_id')) returning id into rid;
 return jsonb_build_object('verification_id',rid);
 when 'create_list' then
 if nullif(trim(p_payload->>'name'),'') is null or nullif(p_payload->>'niche','') is null or not p_payload ? 'selection_logic' then raise exception 'LIST_NAME_NICHE_LOGIC_REQUIRED'; end if;
 insert into lead_engine.lists(name,purpose,niche,selection_logic,experiment_id) values(p_payload->>'name',p_payload->>'purpose',lower(p_payload->>'niche'),p_payload->'selection_logic',(p_payload->>'experiment_id')::uuid) returning id into lid;
 return jsonb_build_object('list_id',lid);
 when 'add_member' then
 if nullif(trim(p_payload->>'reason'),'') is null then raise exception 'SELECTION_REASON_REQUIRED'; end if;
 insert into lead_engine.list_members(list_id,company_id,route_id,selection_reason,selection_snapshot,segment_id)
 values((p_payload->>'list_id')::uuid,(p_payload->>'company_id')::uuid,(p_payload->>'route_id')::uuid,p_payload->>'reason',coalesce(p_payload->'snapshot','{}'),(p_payload->>'segment_id')::uuid)
 on conflict(list_id,company_id) do nothing returning id into mid;
 if mid is null then select id into mid from lead_engine.list_members where list_id=(p_payload->>'list_id')::uuid and company_id=(p_payload->>'company_id')::uuid; end if;
 return jsonb_build_object('member_id',mid);
 when 'qualify' then
 if nullif(trim(p_payload->>'source_url'),'') is null or nullif(trim(p_payload->>'reviewer'),'') is null then raise exception 'QUALIFICATION_EVIDENCE_REQUIRED'; end if;
 update lead_engine.list_members set qualification=p_payload->>'status',qualification_source=p_payload->>'source_url',qualified_by=p_payload->>'reviewer',qualified_at=now() where id=(p_payload->>'member_id')::uuid returning id into mid;
 if mid is null then raise exception 'MEMBER_NOT_FOUND'; end if; return lead_engine.gate(mid);
 when 'gate' then return lead_engine.gate((p_payload->>'member_id')::uuid);
 when 'create_batch' then
 insert into lead_engine.batches(list_id,name,campaign_id) values((p_payload->>'list_id')::uuid,p_payload->>'name',p_payload->>'campaign_id') returning id into bid;
 return jsonb_build_object('batch_id',bid);
 when 'approve_batch' then
 if nullif(trim(p_payload->>'reviewer'),'') is null then raise exception 'REVIEWER_REQUIRED'; end if;
 update lead_engine.batches set status='APPROVED',approved_by=p_payload->>'reviewer',approved_at=now() where id=(p_payload->>'batch_id')::uuid and status='DRAFT' returning id into bid;
 if bid is null then raise exception 'DRAFT_BATCH_REQUIRED'; end if; return jsonb_build_object('batch_id',bid,'status','APPROVED');
 when 'reserve' then return lead_engine.reserve(p_payload);
 when 'enqueue' then
 insert into lead_engine.jobs(company_id,kind,idempotency_key,input) values((p_payload->>'company_id')::uuid,p_payload->>'kind',p_payload->>'idempotency_key',coalesce(p_payload->'input','{}')) on conflict(idempotency_key) do nothing returning id into j;
 if j is null then select id into j from lead_engine.jobs where idempotency_key=p_payload->>'idempotency_key'; end if; return jsonb_build_object('job_id',j);
 when 'claim_job' then return lead_engine.claim_job(p_payload);
 when 'finish_job' then return lead_engine.finish_job(p_payload);
 when 'recover_jobs' then return lead_engine.recover_jobs();
 when 'outcome' then return lead_engine.process_outcome(p_payload);
 when 'status' then
 return jsonb_build_object('metrics',(select jsonb_object_agg(metric,value) from lead_engine.system_status),'integrations',(select jsonb_agg(to_jsonb(i)) from lead_engine.integrations i),'settings',(select jsonb_object_agg(key,value) from lead_engine.settings),'open_incidents',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from lead_engine.incidents where status<>'RESOLVED' order by created_at desc limit 25)x));
 when 'company' then
 cid:=(p_payload->>'company_id')::uuid;
 return jsonb_build_object('company',(select to_jsonb(c) from lead_engine.companies c where id=cid),'routes',(select jsonb_agg(to_jsonb(r)) from lead_engine.contact_routes r where company_id=cid),'observations',(select jsonb_agg(to_jsonb(o)) from lead_engine.observations o where company_id=cid),'jobs',(select jsonb_agg(to_jsonb(j)) from lead_engine.jobs j where company_id=cid),'audits',(select jsonb_agg(to_jsonb(a)) from lead_engine.website_audits a where company_id=cid));
 when 'list_health' then
 lid:=(p_payload->>'list_id')::uuid;
 return (select jsonb_build_object('list_id',lid,'total',count(*),'outreach_ready',count(*) filter(where (g->>'allowed')::boolean),'diagnostics',coalesce(jsonb_agg(g),'[]'),'score',null,'score_note','Weighting not approved; component diagnostics only') from (select lead_engine.gate(id) g from lead_engine.list_members where list_id=lid)x);
 else raise exception 'UNKNOWN_ACTION: %',p_action;
 end case;
end $$;

-- Internal only. No broad authenticated policy; no SECURITY DEFINER escalation.
do $$ declare r record; begin
 for r in select tablename from pg_tables where schemaname='lead_engine' loop execute format('alter table lead_engine.%I enable row level security',r.tablename); end loop;
end $$;
revoke all on all tables in schema lead_engine from public,anon,authenticated;
revoke all on all sequences in schema lead_engine from public,anon,authenticated;
revoke execute on all functions in schema lead_engine from public,anon,authenticated;
grant select,insert,update,delete on all tables in schema lead_engine to service_role;
grant usage,select on all sequences in schema lead_engine to service_role;
grant execute on all functions in schema lead_engine to service_role;
revoke all on lead_engine.events,lead_engine.observations,lead_engine.source_records,lead_engine.outcomes from service_role;
grant select,insert on lead_engine.events,lead_engine.observations,lead_engine.source_records,lead_engine.outcomes to service_role;
revoke execute on function public.le_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.le_command(text,jsonb) to service_role;

insert into lead_engine.integrations(name,status,notes) values
 ('supplied_records','AVAILABLE','Import through le_command ingest; source and external ID required.'),
 ('website_worker','NOT_CONFIGURED','Worker source will be deployed separately; not a running daemon yet.'),
 ('lead_source_provider','NOT_CONFIGURED','No paid sourcing provider selected or connected.'),
 ('email_verifier','NOT_CONFIGURED','Verified provider evidence can be imported; live provider credentials not configured.'),
 ('smartlead','NOT_CONFIGURED','No outbound dispatch enabled. Requires provider setup and tested stop/reconciliation.'),
 ('external_watchdog','NOT_CONFIGURED','Independent external monitoring not configured. Database status is on-demand.');
notify pgrst,'reload schema';
